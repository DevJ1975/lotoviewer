"""Run ORM queries with Postgres RLS applied exactly as PostgREST applies it.

Supabase RLS policies read three transaction-local settings:
  * `role`                 — policies are written `to authenticated`;
  * `request.jwt.claims`   — `auth.uid()` reads `sub`;
  * `request.headers`      — `public.active_tenant_id()` (migration 032) reads
                             `x-active-tenant`, facility scope (migration 211)
                             reads `x-active-facility`.

`rls_session()` sets all three with `is_local = true` inside a fresh
transaction, so they vanish at COMMIT/ROLLBACK and can never leak onto a
pooled connection. It refuses to nest inside an existing transaction for the
same reason: a savepoint does not reset transaction-local settings.

Only pass claims returned by `tenancy.auth.verify_supabase_jwt` — the claims
are trusted as the user's identity.
"""

from __future__ import annotations

import json
import uuid
from contextlib import contextmanager
from typing import TYPE_CHECKING, Any

from django.db import connections, transaction

from tenancy.scoping import rls_enforced

if TYPE_CHECKING:
    from collections.abc import Iterator

_AUTHENTICATED_ROLE = "authenticated"


class RlsSessionError(RuntimeError):
    """rls_session() was used in a way that could leak or skip RLS."""


@contextmanager
def rls_session(
    claims: dict[str, Any],
    *,
    active_tenant_id: uuid.UUID | str | None = None,
    active_facility_id: uuid.UUID | str | None = None,
    using: str = "default",
) -> Iterator[None]:
    if not claims.get("sub"):
        raise RlsSessionError("claims must carry the user's `sub`")
    if claims.get("role") != _AUTHENTICATED_ROLE:
        raise RlsSessionError("claims must be for the `authenticated` role")
    if connections[using].in_atomic_block:
        raise RlsSessionError(
            "rls_session() must open its own transaction; transaction-local "
            "settings would outlive a nested savepoint"
        )

    headers: dict[str, str] = {}
    if active_tenant_id is not None:
        headers["x-active-tenant"] = str(uuid.UUID(str(active_tenant_id)))
    if active_facility_id is not None:
        headers["x-active-facility"] = str(uuid.UUID(str(active_facility_id)))

    with transaction.atomic(using=using):
        with connections[using].cursor() as cursor:
            cursor.execute(
                "select set_config('request.jwt.claims', %s, true),"
                "       set_config('request.headers', %s, true),"
                "       set_config('role', %s, true)",
                [json.dumps(claims), json.dumps(headers), _AUTHENTICATED_ROLE],
            )
        token = rls_enforced.set(True)
        try:
            yield
        finally:
            rls_enforced.reset(token)
