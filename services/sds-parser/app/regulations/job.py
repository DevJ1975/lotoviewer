"""The ``regulation_ingest`` job: load one part of the CFR into the knowledge base.

Platform-level (no tenant): the knowledge base's regulation documents are shared
by every tenant. A superadmin queues it from the web app; the result (counts, and
for a dry run a sample of titles) is stored on the job for them to read.

Payload: ``{"source": "epa-40-cfr-262", "date": "2026-05-07", "dry_run": false}``.
``date`` is the eCFR snapshot to load, normally the part's latest amendment date
from the freshness check.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timezone
from typing import Any

from ..db import open_client
from ..service_jobs import (
    InvalidJobPayload,
    JobContext,
    JobKind,
    PermanentJobError,
    ServiceJob,
)
from .catalog import CATALOG
from .ecfr import EcfrError  # noqa: F401  (re-exported for callers that catch it)
from .http import HttpFailure
from .loader import LoadError, load_source
from .store import SupabaseKnowledgeStore
from .voyage import EmbeddingError, VoyageEmbedder

KIND_NAME = "regulation_ingest"
# Each attempt can spend embedding credits, and sections already written are
# skipped on the next, so one retry covers a blip without compounding cost.
MAX_ATTEMPTS = 2

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def validate_payload(payload: dict) -> dict:
    source = payload.get("source")
    if source not in CATALOG:
        raise InvalidJobPayload(f"source must be one of: {', '.join(sorted(CATALOG))}")

    snapshot = payload.get("date")
    if not isinstance(snapshot, str) or not _DATE_RE.match(snapshot):
        raise InvalidJobPayload("date is required, as YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(snapshot)
    except ValueError as exc:
        raise InvalidJobPayload("date is not a real calendar date") from exc
    if parsed > datetime.now(timezone.utc).date():
        raise InvalidJobPayload("date is in the future")

    dry_run = payload.get("dry_run", False)
    if not isinstance(dry_run, bool):
        raise InvalidJobPayload("dry_run must be true or false")
    return {"source": source, "date": snapshot, "dry_run": dry_run}


def run_regulation_ingest(job: ServiceJob, ctx: JobContext, *, http_client: Any, store: Any) -> dict:
    source = CATALOG[job.payload["source"]]
    try:
        report = load_source(
            source, job.payload["date"],
            http_client=http_client, store=store,
            make_embedder=lambda: VoyageEmbedder.from_env(http_client),
            beat=ctx.heartbeat, dry_run=job.payload.get("dry_run", False),
        )
    except LoadError as exc:
        raise PermanentJobError(str(exc)) from exc
    except (HttpFailure, EmbeddingError) as exc:
        if getattr(exc, "retryable", False):
            raise  # a later attempt may find the service back
        raise PermanentJobError(str(exc)) from exc
    return report.as_dict()


def _handler(job: ServiceJob, ctx: JobContext) -> dict:
    import httpx  # lazy: optional dependency

    with httpx.Client() as http_client:
        return run_regulation_ingest(job, ctx, http_client=http_client, store=SupabaseKnowledgeStore(open_client()))


REGULATION_INGEST_KIND = JobKind(
    name=KIND_NAME,
    handler=_handler,
    tenant_scoped=False,
    validate=validate_payload,
    max_attempts=MAX_ATTEMPTS,
)
