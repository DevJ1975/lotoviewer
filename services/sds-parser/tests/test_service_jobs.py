"""Tests for the generic job framework (app/service_jobs.py and POST /jobs).

The queue's concurrency guarantees (SKIP LOCKED claiming, lease takeover,
dedupe, heartbeats) live in migration 295's SQL; these cover the Python side:
dispatch by kind, retry policy, fencing, the worker loop, the PostgREST calls
and the endpoint.
"""

from __future__ import annotations

import importlib.util
import threading
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Optional
from unittest import mock

from app.service_jobs import (
    RETRY_BACKOFF_SECONDS,
    InvalidJobPayload,
    JobContext,
    JobKind,
    JobNotFoundError,
    JobRegistry,
    JobWorker,
    LeaseLostError,
    PermanentJobError,
    ServiceJob,
    SupabaseJobStore,
    UnknownJobKind,
    enqueue_job,
    process_next_job,
)

TENANT = "22222222-2222-2222-2222-222222222222"


def make_job(kind: str = "demo", attempts: int = 1, max_attempts: int = 3, tenant_id: Optional[str] = TENANT, payload=None) -> ServiceJob:
    return ServiceJob(id="job-1", tenant_id=tenant_id, kind=kind, payload=payload or {}, attempts=attempts, max_attempts=max_attempts)


class FakeStore:
    """In-memory JobStore recording every outcome."""

    def __init__(self, jobs: list[ServiceJob] | None = None, heartbeat_ok: bool = True, fail_recorded: bool = True) -> None:
        self.pending = list(jobs or [])
        self.heartbeat_ok = heartbeat_ok
        self.fail_recorded = fail_recorded
        self.claimed_kinds: list[list[str]] = []
        self.heartbeats: list[Optional[dict]] = []
        self.outcomes: list[tuple] = []
        self.drained = threading.Event()

    def enqueue(self, kind, tenant_id, payload, requested_by, dedupe_key):
        job = ServiceJob(id="new-job", tenant_id=tenant_id, kind=kind.name, payload=payload, attempts=0,
                         max_attempts=kind.max_attempts, status="queued")
        self.outcomes.append(("enqueued", kind.name, tenant_id, payload, dedupe_key))
        return job

    def claim(self, kinds):
        self.claimed_kinds.append(kinds)
        if not self.pending:
            self.drained.set()
            return None
        return self.pending.pop(0)

    def heartbeat(self, job, progress):
        self.heartbeats.append(progress)
        return self.heartbeat_ok

    def succeed(self, job, result):
        self.outcomes.append(("succeeded", job.id, result))

    def requeue(self, job, error):
        self.outcomes.append(("requeued", job.id, error))

    def fail(self, job, error):
        self.outcomes.append(("failed", job.id, error))
        return self.fail_recorded


def registry_with(handler, **kind_options) -> JobRegistry:
    registry = JobRegistry()
    registry.register(JobKind(name="demo", handler=handler, **kind_options))
    return registry


class RegistryTests(unittest.TestCase):
    def test_unknown_kind_is_rejected(self) -> None:
        with self.assertRaises(UnknownJobKind):
            JobRegistry().get("nope")

    def test_a_kind_cannot_be_registered_twice(self) -> None:
        registry = registry_with(lambda job, ctx: None)
        with self.assertRaises(ValueError):
            registry.register(JobKind(name="demo", handler=lambda job, ctx: None))

    def test_names_are_sorted_for_a_stable_claim(self) -> None:
        registry = JobRegistry()
        for name in ("zeta", "alpha"):
            registry.register(JobKind(name=name, handler=lambda job, ctx: None))
        self.assertEqual(registry.names(), ["alpha", "zeta"])


class EnqueueJobTests(unittest.TestCase):
    def enqueue(self, registry, store=None, **overrides):
        store = store or FakeStore()
        args = dict(kind="demo", tenant_id=TENANT, payload={"a": 1})
        args.update(overrides)
        return store, enqueue_job(store, registry, client=object(), **args)

    def test_a_valid_request_is_queued_with_the_normalized_payload(self) -> None:
        registry = registry_with(lambda job, ctx: None, validate=lambda p: {**p, "normalized": True})
        store, job = self.enqueue(registry, dedupe_key="k")
        self.assertEqual(job.kind, "demo")
        self.assertEqual(store.outcomes, [("enqueued", "demo", TENANT, {"a": 1, "normalized": True}, "k")])

    def test_unknown_kind(self) -> None:
        with self.assertRaises(UnknownJobKind):
            self.enqueue(JobRegistry(), kind="nope")

    def test_tenant_scoped_kinds_need_a_tenant(self) -> None:
        with self.assertRaisesRegex(InvalidJobPayload, "needs a tenant_id"):
            self.enqueue(registry_with(lambda job, ctx: None), tenant_id=None)

    def test_platform_kinds_refuse_a_tenant(self) -> None:
        # A platform job writes shared data; letting a tenant id ride along
        # would imply it is scoped when it is not.
        with self.assertRaisesRegex(InvalidJobPayload, "platform-level"):
            self.enqueue(registry_with(lambda job, ctx: None, tenant_scoped=False), tenant_id=TENANT)

    def test_platform_kinds_queue_without_a_tenant(self) -> None:
        store, job = self.enqueue(registry_with(lambda job, ctx: None, tenant_scoped=False), tenant_id=None)
        self.assertIsNone(job.tenant_id)

    def test_invalid_payload_is_rejected_before_queuing(self) -> None:
        def validate(payload):
            raise InvalidJobPayload("missing document_id")

        store = FakeStore()
        with self.assertRaises(InvalidJobPayload):
            self.enqueue(registry_with(lambda job, ctx: None, validate=validate), store=store)
        self.assertEqual(store.outcomes, [])

    def test_verify_hook_runs_with_the_client_tenant_and_clean_payload(self) -> None:
        verify = mock.Mock()
        registry = registry_with(lambda job, ctx: None, verify=verify)
        store = FakeStore()
        enqueue_job(store, registry, client="CLIENT", kind="demo", tenant_id=TENANT, payload={"a": 1})
        verify.assert_called_once_with("CLIENT", TENANT, {"a": 1})

    def test_a_failing_verify_stops_the_request(self) -> None:
        verify = mock.Mock(side_effect=JobNotFoundError("document not found for tenant"))
        store = FakeStore()
        with self.assertRaises(JobNotFoundError):
            self.enqueue(registry_with(lambda job, ctx: None, verify=verify), store=store)
        self.assertEqual(store.outcomes, [])


class ProcessNextJobTests(unittest.TestCase):
    def test_empty_queue_reports_no_work(self) -> None:
        store = FakeStore()
        self.assertFalse(process_next_job(store, registry_with(lambda job, ctx: None)))

    def test_worker_claims_only_registered_kinds(self) -> None:
        store = FakeStore()
        process_next_job(store, registry_with(lambda job, ctx: None))
        self.assertEqual(store.claimed_kinds, [["demo"]])

    def test_handler_result_is_recorded_on_success(self) -> None:
        store = FakeStore([make_job(payload={"x": 2})])
        seen = []

        def handler(job, ctx):
            seen.append(job.payload)
            return {"fields": 4}

        self.assertTrue(process_next_job(store, registry_with(handler)))
        self.assertEqual(seen, [{"x": 2}])
        self.assertEqual(store.outcomes, [("succeeded", "job-1", {"fields": 4})])

    def test_handler_returning_nothing_records_none(self) -> None:
        store = FakeStore([make_job()])
        process_next_job(store, registry_with(lambda job, ctx: None))
        self.assertEqual(store.outcomes, [("succeeded", "job-1", None)])

    def test_permanent_error_fails_without_retry(self) -> None:
        store = FakeStore([make_job(attempts=1)])
        process_next_job(store, registry_with(mock.Mock(side_effect=PermanentJobError("scan is blank"))))
        self.assertEqual(store.outcomes, [("failed", "job-1", "scan is blank")])

    def test_transient_error_is_requeued(self) -> None:
        store = FakeStore([make_job(attempts=1)])
        with self.assertLogs("app.service_jobs", level="ERROR"):
            process_next_job(store, registry_with(mock.Mock(side_effect=ConnectionError("storage timed out"))))
        self.assertEqual(store.outcomes, [("requeued", "job-1", "storage timed out")])

    def test_transient_error_on_the_jobs_final_attempt_gives_up(self) -> None:
        # The limit is the JOB's own max_attempts, not a global constant.
        store = FakeStore([make_job(attempts=2, max_attempts=2)])
        with self.assertLogs("app.service_jobs", level="ERROR"):
            process_next_job(store, registry_with(mock.Mock(side_effect=ConnectionError("down"))))
        outcome, _, error = store.outcomes[0]
        self.assertEqual(outcome, "failed")
        self.assertIn("Gave up after 2 attempts", error)

    def test_losing_the_lease_records_nothing(self) -> None:
        # Another worker owns the job now; recording anything would race it.
        store = FakeStore([make_job()])
        with self.assertLogs("app.service_jobs", level="WARNING"):
            process_next_job(store, registry_with(mock.Mock(side_effect=LeaseLostError("lost"))))
        self.assertEqual(store.outcomes, [])

    def test_a_kind_unregistered_after_claim_is_retried_not_lost(self) -> None:
        # e.g. a rolling deploy where this replica is older than the job's kind.
        store = FakeStore([make_job(kind="newer_kind", attempts=1)])
        with self.assertLogs("app.service_jobs", level="ERROR"):
            process_next_job(store, registry_with(lambda job, ctx: None))
        self.assertEqual(store.outcomes[0][0], "requeued")


class OnFailedHookTests(unittest.TestCase):
    def run_job(self, job, *, handler, hook, fail_recorded=True):
        store = FakeStore([job], fail_recorded=fail_recorded)
        process_next_job(store, registry_with(handler, on_failed=hook))
        return store

    def test_a_permanent_failure_tells_the_kind_why(self) -> None:
        hook = mock.Mock()
        job = make_job()
        self.run_job(job, handler=mock.Mock(side_effect=PermanentJobError("blank scan")), hook=hook)
        hook.assert_called_once_with(job, "blank scan", permanent=True)

    def test_giving_up_after_the_last_attempt_tells_the_kind(self) -> None:
        hook = mock.Mock()
        job = make_job(attempts=3, max_attempts=3)
        with self.assertLogs("app.service_jobs", level="ERROR"):
            self.run_job(job, handler=mock.Mock(side_effect=ConnectionError("down")), hook=hook)
        (called_job, message), options = hook.call_args
        self.assertEqual(called_job, job)
        self.assertIn("Gave up after 3 attempts", message)
        # The message carries the raw exception, so it is not user-safe.
        self.assertEqual(options, {"permanent": False})

    def test_a_retry_is_not_a_failure(self) -> None:
        # The record must keep waiting while attempts remain.
        hook = mock.Mock()
        with self.assertLogs("app.service_jobs", level="ERROR"):
            self.run_job(make_job(attempts=1), handler=mock.Mock(side_effect=ConnectionError("blip")), hook=hook)
        hook.assert_not_called()

    def test_success_and_lost_leases_do_not_call_it(self) -> None:
        hook = mock.Mock()
        self.run_job(make_job(), handler=lambda job, ctx: None, hook=hook)
        with self.assertLogs("app.service_jobs", level="WARNING"):
            self.run_job(make_job(), handler=mock.Mock(side_effect=LeaseLostError("lost")), hook=hook)
        hook.assert_not_called()

    def test_a_failure_that_was_fenced_out_does_not_call_it(self) -> None:
        # The worker that took the job over may be about to succeed; the hook
        # would mark the record failed underneath it.
        hook = mock.Mock()
        store = self.run_job(
            make_job(), handler=mock.Mock(side_effect=PermanentJobError("x")), hook=hook, fail_recorded=False,
        )
        self.assertEqual(store.outcomes[0][0], "failed")
        hook.assert_not_called()

    def test_a_raising_hook_cannot_undo_the_recorded_failure_or_stop_the_worker(self) -> None:
        hook = mock.Mock(side_effect=RuntimeError("database down"))
        with self.assertLogs("app.service_jobs", level="ERROR"):
            store = self.run_job(make_job(), handler=mock.Mock(side_effect=PermanentJobError("x")), hook=hook)
        self.assertEqual(store.outcomes, [("failed", "job-1", "x")])

    def test_a_kind_without_a_hook_fails_normally(self) -> None:
        store = FakeStore([make_job()])
        process_next_job(store, registry_with(mock.Mock(side_effect=PermanentJobError("x"))))
        self.assertEqual(store.outcomes, [("failed", "job-1", "x")])


class JobContextTests(unittest.TestCase):
    def test_heartbeat_passes_progress_to_the_store(self) -> None:
        store = FakeStore()
        JobContext(make_job(), store).heartbeat({"pages_done": 2})
        self.assertEqual(store.heartbeats, [{"pages_done": 2}])

    def test_heartbeat_raises_once_the_lease_is_lost(self) -> None:
        with self.assertRaises(LeaseLostError):
            JobContext(make_job(), FakeStore(heartbeat_ok=False)).heartbeat()

    def test_a_handler_that_loses_its_lease_mid_run_stops_without_recording(self) -> None:
        store = FakeStore([make_job()], heartbeat_ok=False)
        after_heartbeat = mock.Mock()

        def handler(job, ctx):
            ctx.heartbeat({"page": 1})  # raises: someone took the job over
            after_heartbeat()

        with self.assertLogs("app.service_jobs", level="WARNING"):
            process_next_job(store, registry_with(handler))
        after_heartbeat.assert_not_called()
        self.assertEqual(store.outcomes, [])


class JobWorkerTests(unittest.TestCase):
    def test_worker_drains_the_queue_then_stops_promptly(self) -> None:
        store = FakeStore([make_job(), ServiceJob(id="job-2", tenant_id=TENANT, kind="demo", payload={}, attempts=1, max_attempts=3)])
        worker = JobWorker(store, registry_with(lambda job, ctx: None), idle_poll_seconds=60)
        worker.start()
        self.assertTrue(store.drained.wait(timeout=5))
        worker.stop(timeout=5)  # must not wait out the 60 s idle poll
        self.assertEqual([o[1] for o in store.outcomes], ["job-1", "job-2"])
        self.assertFalse(worker._thread.is_alive())

    def test_worker_survives_an_unreachable_store(self) -> None:
        store = FakeStore([make_job()])
        real_claim = store.claim
        failures = iter([ConnectionError("database down")])

        def flaky_claim(kinds):
            failure = next(failures, None)
            if failure:
                raise failure
            return real_claim(kinds)

        store.claim = flaky_claim
        worker = JobWorker(store, registry_with(lambda job, ctx: None), idle_poll_seconds=0.01)
        with self.assertLogs("app.service_jobs", level="ERROR"):
            worker.start()
            self.assertTrue(store.drained.wait(timeout=5))
        worker.stop(timeout=5)
        self.assertEqual(store.outcomes, [("succeeded", "job-1", None)])


class RecordingQuery:
    """Stands in for a PostgREST query builder: records the chain, then answers."""

    def __init__(self, client: "RecordingClient", target: str) -> None:
        self.client, self.target, self.chain = client, target, []

    def __getattr__(self, name):
        def step(*args, **kwargs):
            self.chain.append((name, args))
            return self
        return step

    def execute(self):
        self.client.executed.append((self.target, self.chain))
        return self.client.respond(self.target, self.chain)


class RecordingClient:
    def __init__(self, respond) -> None:
        self.respond = respond
        self.executed: list[tuple[str, list]] = []

    def table(self, name):
        return RecordingQuery(self, name)

    def rpc(self, name, params):
        query = RecordingQuery(self, f"rpc:{name}")
        query.chain.append(("params", (params,)))
        return query


def job_row(**overrides) -> dict:
    return {"id": "job-1", "tenant_id": TENANT, "kind": "demo", "payload": {"a": 1}, "attempts": 0,
            "max_attempts": 3, "status": "queued", **overrides}


def ops(chain) -> list[str]:
    return [name for name, _ in chain]


DEMO_KIND = JobKind(name="demo", handler=lambda job, ctx: None, max_attempts=4)


@unittest.skipUnless(importlib.util.find_spec("postgrest"), "needs the supabase client (requirements.txt)")
class SupabaseJobStoreTests(unittest.TestCase):
    def test_enqueue_inserts_the_job_with_the_kinds_attempt_limit(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row(max_attempts=4)]))
        job = SupabaseJobStore(client).enqueue(DEMO_KIND, TENANT, {"a": 1}, "user-1", None)
        self.assertEqual((job.kind, job.max_attempts, job.tenant_id), ("demo", 4, TENANT))
        inserted = next(args[0] for name, args in client.executed[0][1] if name == "insert")
        self.assertEqual(inserted["max_attempts"], 4)
        self.assertEqual(inserted["requested_by"], "user-1")

    def test_a_deduped_enqueue_returns_the_live_job_without_inserting(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row(status="running", attempts=1)]))
        job = SupabaseJobStore(client).enqueue(DEMO_KIND, TENANT, {}, None, "doc-1")
        self.assertEqual(job.status, "running")
        self.assertFalse(any("insert" in ops(chain) for _, chain in client.executed))
        self.assertIn(("eq", ("tenant_id", TENANT)), client.executed[0][1])  # service role: scope explicitly

    def test_a_platform_dedupe_lookup_matches_the_null_tenant(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row(tenant_id=None)]))
        SupabaseJobStore(client).enqueue(DEMO_KIND, None, {}, None, "ecfr-40-262")
        self.assertIn(("is_", ("tenant_id", "null")), client.executed[0][1])

    def test_enqueue_race_returns_the_winning_job(self) -> None:
        from postgrest.exceptions import APIError

        lookups = iter([[], [job_row(id="job-winner")]])

        def respond(target, chain):
            if "insert" in ops(chain):
                raise APIError({"code": "23505", "message": "duplicate key", "details": None, "hint": None})
            return SimpleNamespace(data=next(lookups))

        job = SupabaseJobStore(RecordingClient(respond)).enqueue(DEMO_KIND, TENANT, {}, None, "doc-1")
        self.assertEqual(job.id, "job-winner")

    def test_a_non_dedupe_database_error_is_not_swallowed(self) -> None:
        from postgrest.exceptions import APIError

        def respond(target, chain):
            raise APIError({"code": "23503", "message": "violates foreign key", "details": None, "hint": None})

        with self.assertRaises(APIError):
            SupabaseJobStore(RecordingClient(respond)).enqueue(DEMO_KIND, TENANT, {}, None, None)

    def test_claim_passes_the_kinds_to_the_skip_locked_rpc(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row(status="running", attempts=1)]))
        job = SupabaseJobStore(client).claim(["demo", "other"])
        self.assertEqual(job.attempts, 1)
        target, chain = client.executed[0]
        self.assertEqual(target, "rpc:claim_service_job")
        self.assertEqual(chain[0][1][0]["p_kinds"], ["demo", "other"])

    def test_claim_on_an_empty_queue_returns_none(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[]))
        self.assertIsNone(SupabaseJobStore(client).claim(["demo"]))

    def test_heartbeat_reports_whether_the_lease_is_still_held(self) -> None:
        held = RecordingClient(lambda target, chain: SimpleNamespace(data=True))
        lost = RecordingClient(lambda target, chain: SimpleNamespace(data=False))
        self.assertTrue(SupabaseJobStore(held).heartbeat(make_job(), {"n": 1}))
        self.assertFalse(SupabaseJobStore(lost).heartbeat(make_job(), None))
        params = held.executed[0][1][0][1][0]
        self.assertEqual((params["p_id"], params["p_attempts"], params["p_progress"]), ("job-1", 1, {"n": 1}))

    def test_finishing_is_fenced_by_status_and_attempt_and_stores_the_result(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row()]))
        SupabaseJobStore(client).succeed(make_job(attempts=2), {"fields": 4})
        chain = client.executed[0][1]
        for fence in (("eq", ("id", "job-1")), ("eq", ("status", "running")), ("eq", ("attempts", 2))):
            self.assertIn(fence, chain)
        changes = next(args[0] for name, args in chain if name == "update")
        self.assertEqual((changes["status"], changes["result"], changes["lease_expires_at"]), ("succeeded", {"fields": 4}, None))

    def test_requeue_backs_off_by_attempt(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row()]))
        before = datetime.now(timezone.utc)
        SupabaseJobStore(client).requeue(make_job(attempts=2), "storage timed out")
        changes = next(args[0] for name, args in client.executed[0][1] if name == "update")
        self.assertEqual(changes["status"], "queued")
        self.assertGreaterEqual(datetime.fromisoformat(changes["run_after"]), before + timedelta(seconds=RETRY_BACKOFF_SECONDS * 2))

    def test_finishing_a_taken_over_job_is_logged_not_raised(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[]))
        with self.assertLogs("app.service_jobs", level="WARNING"):
            recorded = SupabaseJobStore(client).fail(make_job(), "boom")
        self.assertFalse(recorded)

    def test_failing_a_job_this_worker_still_holds_reports_it_recorded(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row(status="failed")]))
        self.assertTrue(SupabaseJobStore(client).fail(make_job(), "boom"))


@unittest.skipUnless(importlib.util.find_spec("httpx"), "needs httpx for FastAPI's TestClient")
class EnqueueEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient

        from app.main import app, get_service_job_store

        self.app, self.dependency = app, get_service_job_store
        self.client = TestClient(app)  # no `with`: lifespan (and its workers) stay off
        self.body = {"kind": "demo", "tenant_id": TENANT, "payload": {"a": 1}}
        self.registry = registry_with(lambda job, ctx: None)
        patcher = mock.patch("app.main.get_registry", return_value=self.registry)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def use_store(self, store) -> None:
        store.client = None  # enqueue_job's verify hook gets this; unused here
        self.app.dependency_overrides[self.dependency] = lambda: store

    def test_disabled_answers_503_so_callers_fall_back(self) -> None:
        with mock.patch.dict("os.environ", {"SERVICE_JOBS_ENABLED": ""}):
            self.assertEqual(self.client.post("/jobs", json=self.body).status_code, 503)

    def test_enqueue_answers_202_with_the_job(self) -> None:
        self.use_store(FakeStore())
        res = self.client.post("/jobs", json={**self.body, "dedupe_key": "doc-1"})
        self.assertEqual(res.status_code, 202)
        self.assertEqual(res.json(), {"job_id": "new-job", "kind": "demo", "status": "queued"})

    def test_unknown_kind_is_400(self) -> None:
        self.use_store(FakeStore())
        self.assertEqual(self.client.post("/jobs", json={**self.body, "kind": "other_kind"}).status_code, 400)

    def test_missing_tenant_for_a_tenant_scoped_kind_is_422(self) -> None:
        self.use_store(FakeStore())
        self.assertEqual(self.client.post("/jobs", json={"kind": "demo"}).status_code, 422)

    def test_malformed_input_is_rejected_at_the_boundary(self) -> None:
        self.use_store(FakeStore())
        for bad in ({**self.body, "kind": "Bad Kind"}, {**self.body, "tenant_id": "not-a-uuid"}, {**self.body, "dedupe_key": "x" * 201}):
            self.assertEqual(self.client.post("/jobs", json=bad).status_code, 422, bad)

    def test_a_missing_referenced_object_is_404(self) -> None:
        registry = registry_with(lambda job, ctx: None, verify=mock.Mock(side_effect=JobNotFoundError("document missing")))
        self.use_store(FakeStore())
        with mock.patch("app.main.get_registry", return_value=registry):
            self.assertEqual(self.client.post("/jobs", json=self.body).status_code, 404)

    def test_api_key_is_checked_first(self) -> None:
        with mock.patch.dict("os.environ", {"SDS_PARSER_API_KEY": "secret", "SERVICE_JOBS_ENABLED": ""}):
            self.assertEqual(self.client.post("/jobs", json=self.body).status_code, 401)


if __name__ == "__main__":
    unittest.main()
