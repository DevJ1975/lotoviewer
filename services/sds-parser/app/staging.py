"""Optional Supabase integration: download an SDS PDF and stage a parse.

Used only by the ``/parse/stage`` endpoint. It mirrors exactly what the web
app's AI parse route writes — ``parsed_payload``, ``parse_model``,
``parse_confidence`` (0..1), and ``parse_review_status='pending'`` on
``chemical_sds_documents`` — so a heuristic parse lands in the same review
queue and the existing ``/apply`` (human approval) flow promotes it to the
product record unchanged.

Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment. The
service-role key bypasses RLS, so every query is explicitly scoped by
``tenant_id`` (and ``product_id`` when supplied) to preserve tenant isolation.
"""

from __future__ import annotations

import os
from typing import Optional

from .parser import PARSER_MODEL
from .schema import CONFIDENCE_SCORE

SDS_BUCKET = "chemical-sds"


class StagingError(RuntimeError):
    """Raised for misconfiguration or when the SDS row can't be found."""


def _client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise StagingError(
            "Supabase staging is not configured. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY to use /parse/stage."
        )
    try:
        from supabase import create_client  # lazy: optional dependency
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise StagingError("supabase client not installed (`pip install supabase`)") from exc
    return create_client(url, key)


def download_sds(sds_id: str, tenant_id: str, product_id: Optional[str] = None) -> bytes:
    """Look up the SDS row (tenant-scoped) and download its PDF from storage."""
    client = _client()
    query = (
        client.table("chemical_sds_documents")
        .select("id, storage_path, tenant_id, product_id")
        .eq("id", sds_id)
        .eq("tenant_id", tenant_id)
    )
    if product_id:
        query = query.eq("product_id", product_id)
    res = query.limit(1).execute()
    rows = res.data or []
    if not rows:
        raise StagingError(f"SDS {sds_id} not found for tenant {tenant_id}")
    storage_path = rows[0]["storage_path"]
    blob = client.storage.from_(SDS_BUCKET).download(storage_path)
    if not blob:
        raise StagingError(f"Failed to download SDS at {storage_path}")
    return bytes(blob)


def stage_parsed(sds_id: str, tenant_id: str, payload: dict) -> dict:
    """Write the parsed payload back to chemical_sds_documents as a pending
    review — identical columns to the AI parse route."""
    client = _client()
    overall = payload.get("confidence", {}).get("overall", "low")
    update = {
        "parsed_payload": payload,
        "parse_model": PARSER_MODEL,
        "parse_confidence": CONFIDENCE_SCORE.get(overall, 0.33),
        "parse_review_status": "pending",
    }
    res = (
        client.table("chemical_sds_documents")
        .update(update)
        .eq("id", sds_id)
        .eq("tenant_id", tenant_id)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise StagingError(f"SDS {sds_id} not updated (not found for tenant {tenant_id})")
    return {
        "id": sds_id,
        "parse_model": PARSER_MODEL,
        "parse_confidence": update["parse_confidence"],
        "parse_review_status": "pending",
    }
