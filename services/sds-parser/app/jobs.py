"""Background SDS parse jobs: a durable queue in Postgres, drained by a worker.

OCR of a scanned SDS takes seconds per page — minutes for a long scan — which
is longer than the web app's serverless routes can wait. So the parse route
enqueues a job (``POST /jobs/parse-sds``) and returns at once; the worker in
this process claims it, parses the PDF, and stages the result into the SDS
Review Queue exactly as ``/parse/stage`` does.

The queue lives in ``public.sds_parse_jobs`` (migration 294), not in memory,
so a restart loses nothing: a job whose worker died keeps status 'running'
until its lease lapses, then the next claim takes it over.
"""

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional, Protocol

from .ocr import MAX_OCR_PAGES, PAGE_TIMEOUT_SECONDS
from .pdf_text import PdfTextError

logger = logging.getLogger(__name__)

# A lease must outlast the slowest legitimate job, or a second worker would
# take over a job that is still running: every OCR page timing out, plus
# headroom for the download and the database writes.
LEASE_SECONDS = MAX_OCR_PAGES * PAGE_TIMEOUT_SECONDS + 300
MAX_ATTEMPTS = 3
# A transient failure (storage or database blip) waits longer before each
# retry, so a short outage does not burn every attempt within seconds.
RETRY_BACKOFF_SECONDS = 60
IDLE_POLL_SECONDS = 5.0


class JobNotFoundError(LookupError):
    """The SDS to parse does not exist for the tenant."""


@dataclass(frozen=True)
class Job:
    id: str
    tenant_id: str
    sds_id: str
    # The claim's fencing token: only the worker holding this attempt may
    # finish the job (see migration 294).
    attempts: int
    status: str = "running"


class JobStore(Protocol):
    def enqueue(self, sds_id: str, tenant_id: str, requested_by: Optional[str]) -> Job: ...
    def claim(self) -> Optional[Job]: ...
    def succeed(self, job: Job) -> None: ...
    def requeue(self, job: Job, error: str) -> None: ...
    def fail(self, job: Job, error: str) -> None: ...


def process_next_job(store: JobStore, run_job: Callable[[Job], None]) -> bool:
    """Claim and run one job. Returns False when the queue is empty."""
    job = store.claim()
    if job is None:
        return False
    try:
        run_job(job)
    except PdfTextError as exc:
        # The document itself is unreadable; another attempt reads the same bytes.
        store.fail(job, str(exc))
    except Exception as exc:  # network, storage, database: worth another attempt
        logger.exception("SDS parse job %s failed on attempt %d", job.id, job.attempts)
        if job.attempts >= MAX_ATTEMPTS:
            store.fail(job, f"Gave up after {job.attempts} attempts: {exc}")
        else:
            store.requeue(job, str(exc))
    else:
        store.succeed(job)
    return True


class JobWorker:
    """Drains the queue on a daemon thread until stopped."""

    def __init__(
        self,
        store: JobStore,
        run_job: Callable[[Job], None],
        idle_poll_seconds: float = IDLE_POLL_SECONDS,
    ) -> None:
        self._store = store
        self._run_job = run_job
        self._idle_poll_seconds = idle_poll_seconds
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, name="sds-parse-jobs", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._thread.join(timeout)

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                worked = process_next_job(self._store, self._run_job)
            except Exception:  # the store itself is unreachable; back off, stay alive
                logger.exception("SDS parse job worker could not reach the job store")
                worked = False
            if not worked:
                self._stop.wait(self._idle_poll_seconds)


class SupabaseJobStore:
    """JobStore over PostgREST with the service-role key.

    The service role bypasses RLS, so every lookup is scoped by tenant_id
    explicitly, and every finishing write is fenced by (status, attempts).
    """

    TABLE = "sds_parse_jobs"

    def __init__(self, client) -> None:
        self._client = client

    def enqueue(self, sds_id: str, tenant_id: str, requested_by: Optional[str]) -> Job:
        from postgrest.exceptions import APIError  # lazy: optional dependency

        sds = (
            self._client.table("chemical_sds_documents")
            .select("id").eq("id", sds_id).eq("tenant_id", tenant_id).limit(1).execute()
        )
        if not sds.data:
            raise JobNotFoundError(f"SDS {sds_id} not found for tenant {tenant_id}")

        existing = self._live_job(sds_id, tenant_id)
        if existing:
            return existing
        try:
            res = self._client.table(self.TABLE).insert(
                {"sds_id": sds_id, "tenant_id": tenant_id, "requested_by": requested_by}
            ).execute()
        except APIError as exc:
            # Lost a race with a concurrent enqueue for the same SDS: the
            # one-live-job index rejected ours, so return the winner.
            if exc.code == "23505":
                winner = self._live_job(sds_id, tenant_id)
                if winner:
                    return winner
            raise
        return _job_from_row(res.data[0])

    def claim(self) -> Optional[Job]:
        res = self._client.rpc(
            "claim_sds_parse_job",
            {"p_lease_seconds": LEASE_SECONDS, "p_max_attempts": MAX_ATTEMPTS},
        ).execute()
        rows = res.data or []
        return _job_from_row(rows[0]) if rows else None

    def succeed(self, job: Job) -> None:
        self._finish(job, {"status": "succeeded", "finished_at": _now(), "last_error": None})

    def requeue(self, job: Job, error: str) -> None:
        retry_at = datetime.now(timezone.utc) + timedelta(seconds=RETRY_BACKOFF_SECONDS * job.attempts)
        self._finish(job, {"status": "queued", "run_after": retry_at.isoformat(), "last_error": error})

    def fail(self, job: Job, error: str) -> None:
        self._finish(job, {"status": "failed", "finished_at": _now(), "last_error": error})

    def _finish(self, job: Job, changes: dict) -> None:
        res = (
            self._client.table(self.TABLE)
            .update({**changes, "lease_expires_at": None})
            .eq("id", job.id).eq("status", "running").eq("attempts", job.attempts)
            .execute()
        )
        if not res.data:
            # Our lease lapsed and another worker took the job over; its
            # outcome stands. Our staged parse was identical, so nothing is lost.
            logger.warning("SDS parse job %s attempt %d was taken over; not recording", job.id, job.attempts)

    def _live_job(self, sds_id: str, tenant_id: str) -> Optional[Job]:
        res = (
            self._client.table(self.TABLE)
            .select("*").eq("sds_id", sds_id).eq("tenant_id", tenant_id)
            .in_("status", ["queued", "running"]).limit(1).execute()
        )
        return _job_from_row(res.data[0]) if res.data else None


def _job_from_row(row: dict) -> Job:
    return Job(
        id=row["id"], tenant_id=row["tenant_id"], sds_id=row["sds_id"],
        attempts=row["attempts"], status=row["status"],
    )


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()
