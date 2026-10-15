"""Verifies the privileges migration 294 actually grants platform_svc."""

import pytest
from django.db import ProgrammingError, connection, transaction

pytestmark = pytest.mark.django_db(transaction=True)


def _as_platform_svc(*statements: str) -> list[tuple]:
    """Run statements as platform_svc in one transaction; return the last result."""
    rows: list[tuple] = []
    with transaction.atomic(), connection.cursor() as cursor:
        cursor.execute("set local role platform_svc")
        for sql in statements:
            cursor.execute(sql)
            rows = cursor.fetchall() if cursor.description else []
    return rows


def test_reads_granted_tables_across_tenants_via_its_own_policy():
    assert _as_platform_svc("select count(*) from public.facilities") == [(3,)]
    assert _as_platform_svc("select count(*) from public.tenants") == [(2,)]


def test_cannot_write_to_supabase_owned_tables():
    with pytest.raises(ProgrammingError, match="permission denied"):
        _as_platform_svc("update public.tenants set name = name")


def test_membership_in_authenticated_does_not_leak_its_privileges():
    with pytest.raises(ProgrammingError, match="permission denied"):
        _as_platform_svc("select * from public.incidents")


def test_can_switch_to_authenticated_for_rls_impersonation():
    # Mirrors PostgREST, which always sets request.headers to a JSON object;
    # public.active_tenant_id() cannot parse an empty setting.
    rows = _as_platform_svc(
        "set local role authenticated",
        "select set_config('request.headers', '{}', true)",
        "select count(*) from public.incidents",
    )
    assert rows == [(0,)]


def test_owns_the_platform_schema():
    _as_platform_svc("create table platform.__probe (id int)", "drop table platform.__probe")
