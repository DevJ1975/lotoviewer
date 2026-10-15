"""Structural tenant isolation for system (non-user) database work.

Workers and rollups run as the `platform_svc` role, whose read policies are
NOT tenant-scoped (see migration 294). Isolation therefore has to be enforced
in code, and the safest place is the queryset: a query against a
tenant-owned table refuses to execute unless it is provably scoped.

A queryset counts as scoped when ANY of these hold:
  * it was filtered by a single tenant (`.for_tenant(id)`, or `.filter(...)`
    with `tenant`, `tenant_id` or `tenant__id` — which also covers
    reverse-relation managers such as `tenant.facilities.all()`);
  * it runs inside `rls_session()`, where Postgres RLS does the scoping;
  * the caller opted out explicitly with `.across_all_tenants(reason=...)`,
    which logs the reason so cross-tenant reads are auditable.

Anything else raises `UnscopedTenantQueryError` before SQL is sent.
"""

from __future__ import annotations

import logging
import uuid
from contextvars import ContextVar
from typing import TYPE_CHECKING, Any, Self, TypeVar

from django.db import models

if TYPE_CHECKING:
    from collections.abc import Iterator

logger = logging.getLogger(__name__)

_T = TypeVar("_T", bound=models.Model)

_SCOPING_KEYS = frozenset(
    {"tenant", "tenant_id", "tenant__id", "tenant__pk", "tenant__exact", "tenant_id__exact"}
)

rls_enforced: ContextVar[bool] = ContextVar("rls_enforced", default=False)


class UnscopedTenantQueryError(RuntimeError):
    """A tenant-owned table was queried without a tenant scope."""


class TenantScopedQuerySet(models.QuerySet[_T]):
    _tenant_scoped: bool = False

    def for_tenant(self, tenant_id: uuid.UUID | str) -> Self:
        return self.filter(tenant_id=uuid.UUID(str(tenant_id)))

    def across_all_tenants(self, *, reason: str) -> Self:
        if not reason.strip():
            raise ValueError("across_all_tenants() requires a non-empty reason")
        logger.info(
            "cross-tenant query on %s: %s",
            self.model._meta.db_table,
            reason,
        )
        clone = self.all()
        clone._tenant_scoped = True
        return clone

    def filter(self, *args: Any, **kwargs: Any) -> Self:
        clone = super().filter(*args, **kwargs)
        if _names_single_tenant(kwargs):
            clone._tenant_scoped = True
        return clone

    # Django copies querysets through _clone() on every chained call; the stubs
    # omit it because it is private, but it is the only hook that sees them all.
    def _clone(self) -> Self:
        clone: Self = super()._clone()  # type: ignore[misc]
        clone._tenant_scoped = self._tenant_scoped
        return clone

    def _assert_scoped(self) -> None:
        if self._tenant_scoped or rls_enforced.get():
            return
        raise UnscopedTenantQueryError(
            f"Query on tenant-owned table {self.model._meta.db_table!r} has no tenant scope. "
            "Use .for_tenant(id), run inside rls_session(), or call "
            ".across_all_tenants(reason=...) for deliberate cross-tenant work."
        )

    # Every read and write path funnels through one of these.
    def _fetch_all(self) -> None:
        self._assert_scoped()
        super()._fetch_all()

    def iterator(self, chunk_size: int | None = None) -> Iterator[_T]:
        self._assert_scoped()
        return super().iterator(chunk_size=chunk_size)

    def count(self) -> int:
        self._assert_scoped()
        return super().count()

    def exists(self) -> bool:
        self._assert_scoped()
        return super().exists()

    def aggregate(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        self._assert_scoped()
        return super().aggregate(*args, **kwargs)

    def update(self, **kwargs: Any) -> int:
        self._assert_scoped()
        return super().update(**kwargs)

    def delete(self) -> tuple[int, dict[str, int]]:
        self._assert_scoped()
        return super().delete()


def _names_single_tenant(kwargs: dict[str, Any]) -> bool:
    return any(
        key in _SCOPING_KEYS and value is not None and not isinstance(value, (list, tuple, set))
        for key, value in kwargs.items()
    )
