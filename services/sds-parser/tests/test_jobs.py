"""Tests for background SDS parse jobs (app/jobs.py and POST /jobs/parse-sds).

The queue's concurrency guarantees (SKIP LOCKED claiming, lease takeover, the
one-live-job index) live in migration 294's SQL; these tests cover the Python
side: retry policy, the worker loop, the PostgREST calls, and the endpoint.
"""

from __future__ import annotations

import importlib.util
import threading
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from app.jobs import (
    MAX_ATTEMPTS,
    RETRY_BACKOFF_SECONDS,
    Job,
    JobNotFoundError,
    JobWorker,
    SupabaseJobStore,
    process_next_job,
)
from app.pdf_text import PdfTextError

SDS_ID = "11111111-1111-1111-1111-111111111111"
TENANT_ID = "22222222-2222-2222-2222-222222222222"


def make_job(attempts: int = 1, status: str = "running") -> Job:
    return Job(id="job-1", tenant_id=TENANT_ID, sds_id=SDS_ID, attempts=attempts, status=status)


class FakeStore:
    """In-memory JobStore that records every outcome."""

    def __init__(self, jobs: list[Job] | None = None) -> None:
        self.pending = list(jobs or [])
        self.outcomes: list[tuple[str, str, str | None]] = []
        self.drained = threading.Event()

    def enqueue(self, sds_id, tenant_id, requested_by):  # pragma: no cover - API tests use their own
        raise NotImplementedError

    def claim(self):
        if not self.pending:
            self.drained.set()
            return None
        return self.pending.pop(0)

    def succeed(self, job):
        self.outcomes.append(("succeeded", job.id, None))

    def requeue(self, job, error):
        self.outcomes.append(("requeued", job.id, error))

    def fail(self, job, error):
        self.outcomes.append(("failed", job.id, error))


class ProcessNextJobTests(unittest.TestCase):
    def test_empty_queue_reports_no_work(self) -> None:
        store = FakeStore()
        self.assertFalse(process_next_job(store, run_job=mock.Mock()))
        self.assertEqual(store.outcomes, [])

    def test_successful_job_is_marked_succeeded(self) -> None:
        store = FakeStore([make_job()])
        run_job = mock.Mock()
        self.assertTrue(process_next_job(store, run_job))
        run_job.assert_called_once_with(make_job())
        self.assertEqual(store.outcomes, [("succeeded", "job-1", None)])

    def test_unreadable_pdf_fails_without_retry(self) -> None:
        # Another attempt would read the same bytes, so retrying only wastes OCR time.
        store = FakeStore([make_job(attempts=1)])
        process_next_job(store, mock.Mock(side_effect=PdfTextError("scan is blank")))
        self.assertEqual(store.outcomes, [("failed", "job-1", "scan is blank")])

    def test_transient_error_is_retried(self) -> None:
        store = FakeStore([make_job(attempts=1)])
        with self.assertLogs("app.jobs", level="ERROR"):
            process_next_job(store, mock.Mock(side_effect=ConnectionError("storage timed out")))
        self.assertEqual(store.outcomes, [("requeued", "job-1", "storage timed out")])

    def test_transient_error_on_final_attempt_gives_up(self) -> None:
        store = FakeStore([make_job(attempts=MAX_ATTEMPTS)])
        with self.assertLogs("app.jobs", level="ERROR"):
            process_next_job(store, mock.Mock(side_effect=ConnectionError("storage timed out")))
        outcome, _, error = store.outcomes[0]
        self.assertEqual(outcome, "failed")
        self.assertIn(f"Gave up after {MAX_ATTEMPTS} attempts", error)


class JobWorkerTests(unittest.TestCase):
    def test_worker_drains_the_queue_then_stops_promptly(self) -> None:
        store = FakeStore([make_job(), Job(id="job-2", tenant_id=TENANT_ID, sds_id=SDS_ID, attempts=1)])
        worker = JobWorker(store, run_job=mock.Mock(), idle_poll_seconds=60)
        worker.start()
        self.assertTrue(store.drained.wait(timeout=5))
        worker.stop(timeout=5)  # must not wait out the 60 s idle poll
        self.assertEqual([job_id for _, job_id, _ in store.outcomes], ["job-1", "job-2"])
        self.assertFalse(worker._thread.is_alive())

    def test_worker_survives_an_unreachable_store(self) -> None:
        store = FakeStore([make_job()])
        real_claim = store.claim
        calls = iter([ConnectionError("database down")])

        def flaky_claim():
            failure = next(calls, None)
            if failure:
                raise failure
            return real_claim()

        store.claim = flaky_claim
        worker = JobWorker(store, run_job=mock.Mock(), idle_poll_seconds=0.01)
        with self.assertLogs("app.jobs", level="ERROR"):
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
    return {"id": "job-1", "tenant_id": TENANT_ID, "sds_id": SDS_ID, "attempts": 0, "status": "queued", **overrides}


def ops(chain) -> list[str]:
    return [name for name, _ in chain]


@unittest.skipUnless(importlib.util.find_spec("postgrest"), "needs the supabase client (requirements.txt)")
class SupabaseJobStoreTests(unittest.TestCase):
    def test_enqueue_inserts_a_job_for_an_existing_sds(self) -> None:
        def respond(target, chain):
            if target == "chemical_sds_documents":
                return SimpleNamespace(data=[{"id": SDS_ID}])
            if "insert" in ops(chain):
                return SimpleNamespace(data=[job_row()])
            return SimpleNamespace(data=[])  # no live job yet

        client = RecordingClient(respond)
        job = SupabaseJobStore(client).enqueue(SDS_ID, TENANT_ID, None)
        self.assertEqual((job.id, job.status), ("job-1", "queued"))
        sds_lookup = client.executed[0][1]
        self.assertIn(("eq", ("tenant_id", TENANT_ID)), sds_lookup)  # service role: scope explicitly

    def test_enqueue_returns_the_live_job_instead_of_queuing_twice(self) -> None:
        def respond(target, chain):
            if target == "chemical_sds_documents":
                return SimpleNamespace(data=[{"id": SDS_ID}])
            return SimpleNamespace(data=[job_row(status="running", attempts=1)])

        client = RecordingClient(respond)
        job = SupabaseJobStore(client).enqueue(SDS_ID, TENANT_ID, None)
        self.assertEqual(job.status, "running")
        self.assertFalse(any("insert" in ops(chain) for _, chain in client.executed))

    def test_enqueue_race_returns_the_winning_job(self) -> None:
        from postgrest.exceptions import APIError

        live_lookups = iter([[], [job_row(id="job-winner")]])

        def respond(target, chain):
            if target == "chemical_sds_documents":
                return SimpleNamespace(data=[{"id": SDS_ID}])
            if "insert" in ops(chain):
                raise APIError({"code": "23505", "message": "duplicate key", "details": None, "hint": None})
            return SimpleNamespace(data=next(live_lookups))

        job = SupabaseJobStore(RecordingClient(respond)).enqueue(SDS_ID, TENANT_ID, None)
        self.assertEqual(job.id, "job-winner")

    def test_enqueue_for_another_tenants_sds_is_not_found(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[]))
        with self.assertRaises(JobNotFoundError):
            SupabaseJobStore(client).enqueue(SDS_ID, TENANT_ID, None)

    def test_claim_calls_the_skip_locked_rpc(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row(status="running", attempts=1)]))
        job = SupabaseJobStore(client).claim()
        self.assertEqual(job.attempts, 1)
        self.assertEqual(client.executed[0][0], "rpc:claim_sds_parse_job")

    def test_claim_on_empty_queue_returns_none(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[]))
        self.assertIsNone(SupabaseJobStore(client).claim())

    def test_finishing_is_fenced_by_status_and_attempt(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row()]))
        SupabaseJobStore(client).succeed(make_job(attempts=2))
        chain = client.executed[0][1]
        for fence in (("eq", ("id", "job-1")), ("eq", ("status", "running")), ("eq", ("attempts", 2))):
            self.assertIn(fence, chain)

    def test_requeue_backs_off_by_attempt(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[job_row()]))
        before = datetime.now(timezone.utc)
        SupabaseJobStore(client).requeue(make_job(attempts=2), "storage timed out")
        changes = next(args[0] for name, args in client.executed[0][1] if name == "update")
        self.assertEqual(changes["status"], "queued")
        retry_at = datetime.fromisoformat(changes["run_after"])
        self.assertGreaterEqual(retry_at, before + timedelta(seconds=RETRY_BACKOFF_SECONDS * 2))

    def test_finishing_a_taken_over_job_is_logged_not_raised(self) -> None:
        client = RecordingClient(lambda target, chain: SimpleNamespace(data=[]))
        with self.assertLogs("app.jobs", level="WARNING"):
            SupabaseJobStore(client).fail(make_job(attempts=1), "boom")


class EnqueueStore(FakeStore):
    def __init__(self, known_sds: set[str]) -> None:
        super().__init__()
        self.known_sds = known_sds
        self.live: dict[str, Job] = {}

    def enqueue(self, sds_id, tenant_id, requested_by):
        if sds_id not in self.known_sds:
            raise JobNotFoundError(f"SDS {sds_id} not found for tenant {tenant_id}")
        job = self.live.setdefault(
            sds_id, Job(id=f"job-{len(self.live) + 1}", tenant_id=tenant_id, sds_id=sds_id, attempts=0, status="queued")
        )
        return job


@unittest.skipUnless(importlib.util.find_spec("httpx"), "needs httpx for FastAPI's TestClient")
class EnqueueEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi.testclient import TestClient

        from app.main import app, get_job_store

        self.app, self.get_job_store = app, get_job_store
        self.client = TestClient(app)  # no `with`: lifespan (and its worker) stays off
        self.body = {"sds_id": SDS_ID, "tenant_id": TENANT_ID}

    def tearDown(self) -> None:
        self.app.dependency_overrides.clear()

    def use_store(self, store) -> None:
        self.app.dependency_overrides[self.get_job_store] = lambda: store

    def test_disabled_jobs_answer_503_so_the_web_app_falls_back(self) -> None:
        with mock.patch.dict("os.environ", {"SDS_PARSE_JOBS_ENABLED": ""}):
            res = self.client.post("/jobs/parse-sds", json=self.body)
        self.assertEqual(res.status_code, 503)

    def test_enqueue_answers_202_and_is_idempotent(self) -> None:
        self.use_store(EnqueueStore({SDS_ID}))
        first = self.client.post("/jobs/parse-sds", json=self.body)
        second = self.client.post("/jobs/parse-sds", json=self.body)
        self.assertEqual(first.status_code, 202)
        self.assertEqual(first.json(), {"job_id": "job-1", "status": "queued"})
        self.assertEqual(second.json()["job_id"], "job-1")

    def test_unknown_sds_is_404(self) -> None:
        self.use_store(EnqueueStore(set()))
        self.assertEqual(self.client.post("/jobs/parse-sds", json=self.body).status_code, 404)

    def test_malformed_ids_are_rejected_at_the_boundary(self) -> None:
        self.use_store(EnqueueStore({SDS_ID}))
        res = self.client.post("/jobs/parse-sds", json={"sds_id": "not-a-uuid", "tenant_id": TENANT_ID})
        self.assertEqual(res.status_code, 422)

    def test_api_key_is_checked_before_anything_else(self) -> None:
        with mock.patch.dict("os.environ", {"SDS_PARSER_API_KEY": "secret", "SDS_PARSE_JOBS_ENABLED": ""}):
            missing = self.client.post("/jobs/parse-sds", json=self.body)
            self.assertEqual(missing.status_code, 401)


if __name__ == "__main__":
    unittest.main()
