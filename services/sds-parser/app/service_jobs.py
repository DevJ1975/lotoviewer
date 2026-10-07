"""Generic background jobs: one durable queue, many kinds of work.

The SDS parse queue (``jobs.py``, migration 294) is specific to one feature.
This is the reusable version (migration 295): a job has a ``kind`` and a JSON
``payload``, and a *registry* maps each kind to a handler. Adding a kind means
registering a handler — no migration, no new worker.

Guarantees, all enforced in Postgres (see migration 295):

* Claims use ``FOR UPDATE SKIP LOCKED``, so replicas share the queue without
  double-processing, and a worker claims only the kinds it has handlers for.
* ``attempts`` is the fencing token. A worker that lost its lease can neither
  finish the job nor extend it, so it can never overwrite the result of the
  worker that took over.
* A long handler extends its own lease between units of work with
  ``ctx.heartbeat()``. The lease therefore only has to cover one unit (an OCR
  page, an embedding batch), not the slowest whole job.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Optional, Protocol

logger = logging.getLogger(__name__)

# One unit of work must finish (or heartbeat) inside this.
LEASE_SECONDS = 300
# A transient failure waits longer before each retry, so a short outage does not
# burn every attempt within seconds.
RETRY_BACKOFF_SECONDS = 60
IDLE_POLL_SECONDS = 5.0


class JobError(Exception):
    """Base for errors a handler or the registry raises on purpose."""


class PermanentJobError(JobError):
    """The job can never succeed (unreadable file, bad payload). Fail it now:
    another attempt would read the same bytes."""


class LeaseLostError(JobError):
    """Another worker took the job over. Stop quietly; its outcome stands."""


class JobNotFoundError(LookupError):
    """A thing the job refers to does not exist for the tenant."""


class UnknownJobKind(LookupError):
    """No handler is registered for this kind."""


class InvalidJobPayload(ValueError):
    """The payload does not have the shape the kind requires."""


@dataclass(frozen=True)
class ServiceJob:
    id: str
    tenant_id: Optional[str]
    kind: str
    payload: dict
    # Claim count; the fencing token (see module docstring).
    attempts: int
    max_attempts: int
    status: str = "running"


class JobContext:
    """What a handler may do besides read its job: extend the lease and report
    progress. ``heartbeat`` raises LeaseLostError when the job was taken over,
    which is how a handler learns to stop."""

    def __init__(self, job: ServiceJob, store: "JobStore") -> None:
        self.job = job
        self._store = store

    def heartbeat(self, progress: Optional[dict] = None) -> None:
        if not self._store.heartbeat(self.job, progress):
            raise LeaseLostError(f"job {self.job.id} attempt {self.job.attempts} lost its lease")


Handler = Callable[[ServiceJob, JobContext], Optional[dict]]


@dataclass(frozen=True)
class JobKind:
    name: str
    handler: Handler
    # Platform-level kinds (loading shared regulations) have no tenant.
    tenant_scoped: bool = True
    # Returns the normalized payload or raises InvalidJobPayload.
    validate: Callable[[dict], dict] = lambda payload: payload
    # Checked before queuing so a bad reference fails at the request, not later
    # on the worker. Raises JobNotFoundError. Gets (client, tenant_id, payload).
    verify: Optional[Callable[[Any, Optional[str], dict], None]] = None
    max_attempts: int = 3


@dataclass
class JobRegistry:
    _kinds: dict[str, JobKind] = field(default_factory=dict)

    def register(self, kind: JobKind) -> None:
        if kind.name in self._kinds:
            raise ValueError(f"job kind {kind.name!r} is already registered")
        self._kinds[kind.name] = kind

    def get(self, name: str) -> JobKind:
        try:
            return self._kinds[name]
        except KeyError:
            raise UnknownJobKind(f"no handler for job kind {name!r}") from None

    def names(self) -> list[str]:
        return sorted(self._kinds)


class JobStore(Protocol):
    def enqueue(
        self, kind: JobKind, tenant_id: Optional[str], payload: dict,
        requested_by: Optional[str], dedupe_key: Optional[str],
    ) -> ServiceJob: ...
    def claim(self, kinds: list[str]) -> Optional[ServiceJob]: ...
    def heartbeat(self, job: ServiceJob, progress: Optional[dict]) -> bool: ...
    def succeed(self, job: ServiceJob, result: Optional[dict]) -> None: ...
    def requeue(self, job: ServiceJob, error: str) -> None: ...
    def fail(self, job: ServiceJob, error: str) -> None: ...


def enqueue_job(
    store: JobStore, registry: JobRegistry, client: Any, *, kind: str,
    tenant_id: Optional[str], payload: dict, requested_by: Optional[str] = None,
    dedupe_key: Optional[str] = None,
) -> ServiceJob:
    """Validate a request against its kind, then queue it (idempotently when a
    dedupe_key is given)."""
    job_kind = registry.get(kind)
    if job_kind.tenant_scoped and not tenant_id:
        raise InvalidJobPayload(f"job kind {kind!r} needs a tenant_id")
    if not job_kind.tenant_scoped and tenant_id:
        raise InvalidJobPayload(f"job kind {kind!r} is platform-level and takes no tenant_id")
    clean = job_kind.validate(payload)
    if job_kind.verify:
        job_kind.verify(client, tenant_id, clean)
    return store.enqueue(job_kind, tenant_id, clean, requested_by, dedupe_key)


def process_next_job(store: JobStore, registry: JobRegistry) -> bool:
    """Claim and run one job. Returns False when there was nothing to run."""
    job = store.claim(registry.names())
    if job is None:
        return False
    try:
        kind = registry.get(job.kind)
        result = kind.handler(job, JobContext(job, store))
    except LeaseLostError as exc:
        logger.warning("%s", exc)  # someone else owns the job now; record nothing
    except PermanentJobError as exc:
        store.fail(job, str(exc))
    except Exception as exc:  # network, storage, database: worth another attempt
        logger.exception("job %s (%s) failed on attempt %d", job.id, job.kind, job.attempts)
        if job.attempts >= job.max_attempts:
            store.fail(job, f"Gave up after {job.attempts} attempts: {exc}")
        else:
            store.requeue(job, str(exc))
    else:
        store.succeed(job, result)
    return True


class JobWorker:
    """Drains the queue on a daemon thread until stopped."""

    def __init__(self, store: JobStore, registry: JobRegistry, idle_poll_seconds: float = IDLE_POLL_SECONDS) -> None:
        self._store = store
        self._registry = registry
        self._idle_poll_seconds = idle_poll_seconds
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="service-jobs", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._thread.join(timeout)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                worked = process_next_job(self._store, self._registry)
            except Exception:  # the store itself is unreachable; back off, stay alive
                logger.exception("service job worker could not reach the job store")
                worked = False
            if not worked:
                self._stop.wait(self._idle_poll_seconds)


class SupabaseJobStore:
    """JobStore over PostgREST with the service-role key.

    The service role bypasses RLS, so lookups are scoped by tenant explicitly,
    and every finishing write is fenced by (status, attempts).
    """

    TABLE = "service_jobs"

    def __init__(self, client) -> None:
        self._client = client

    @property
    def client(self):
        return self._client

    def enqueue(self, kind, tenant_id, payload, requested_by, dedupe_key) -> ServiceJob:
        from postgrest.exceptions import APIError  # lazy: optional dependency

        if dedupe_key:
            existing = self._live_job(kind.name, tenant_id, dedupe_key)
            if existing:
                return existing
        row = {
            "kind": kind.name, "tenant_id": tenant_id, "payload": payload,
            "requested_by": requested_by, "dedupe_key": dedupe_key,
            "max_attempts": kind.max_attempts,
        }
        try:
            res = self._client.table(self.TABLE).insert(row).execute()
        except APIError as exc:
            # Lost a race with a concurrent enqueue for the same key: the
            # one-live-job index rejected ours, so return the winner.
            if exc.code == "23505" and dedupe_key:
                winner = self._live_job(kind.name, tenant_id, dedupe_key)
                if winner:
                    return winner
            raise
        return _job_from_row(res.data[0])

    def claim(self, kinds: list[str]) -> Optional[ServiceJob]:
        res = self._client.rpc(
            "claim_service_job", {"p_kinds": kinds, "p_lease_seconds": LEASE_SECONDS},
        ).execute()
        rows = res.data or []
        return _job_from_row(rows[0]) if rows else None

    def heartbeat(self, job: ServiceJob, progress: Optional[dict]) -> bool:
        res = self._client.rpc(
            "heartbeat_service_job",
            {"p_id": job.id, "p_attempts": job.attempts, "p_lease_seconds": LEASE_SECONDS, "p_progress": progress},
        ).execute()
        return bool(res.data)

    def succeed(self, job: ServiceJob, result: Optional[dict]) -> None:
        self._finish(job, {"status": "succeeded", "finished_at": _now(), "last_error": None, "result": result})

    def requeue(self, job: ServiceJob, error: str) -> None:
        retry_at = datetime.now(timezone.utc) + timedelta(seconds=RETRY_BACKOFF_SECONDS * job.attempts)
        self._finish(job, {"status": "queued", "run_after": retry_at.isoformat(), "last_error": error})

    def fail(self, job: ServiceJob, error: str) -> None:
        self._finish(job, {"status": "failed", "finished_at": _now(), "last_error": error})

    def _finish(self, job: ServiceJob, changes: dict) -> None:
        res = (
            self._client.table(self.TABLE)
            .update({**changes, "lease_expires_at": None})
            .eq("id", job.id).eq("status", "running").eq("attempts", job.attempts)
            .execute()
        )
        if not res.data:
            logger.warning("job %s attempt %d was taken over; not recording", job.id, job.attempts)

    def _live_job(self, kind: str, tenant_id: Optional[str], dedupe_key: str) -> Optional[ServiceJob]:
        query = (
            self._client.table(self.TABLE).select("*")
            .eq("kind", kind).eq("dedupe_key", dedupe_key).in_("status", ["queued", "running"])
        )
        query = query.eq("tenant_id", tenant_id) if tenant_id else query.is_("tenant_id", "null")
        res = query.limit(1).execute()
        return _job_from_row(res.data[0]) if res.data else None


def _job_from_row(row: dict) -> ServiceJob:
    return ServiceJob(
        id=row["id"], tenant_id=row.get("tenant_id"), kind=row["kind"],
        payload=row.get("payload") or {}, attempts=row["attempts"],
        max_attempts=row.get("max_attempts", 3), status=row["status"],
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
