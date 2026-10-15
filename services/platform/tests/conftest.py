"""Test database bootstrap.

Before Django creates its own tables, the test database is shaped like a
Supabase project (tests/sql/supabase_stub.sql) and then the REAL migration
294 is applied, so the role, schema and policies under test are exactly the
ones that ship. `pre_migrate` fires before Django creates `django_migrations`,
which must land in the `platform` schema the migration creates.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from django.db import connections
from django.db.models.signals import pre_migrate

SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_ROOT.parent.parent
STUB_SQL = SERVICE_ROOT / "tests" / "sql" / "supabase_stub.sql"
PLATFORM_ROLE_MIGRATION = (
    REPO_ROOT / "apps" / "web" / "migrations" / "294_platform_service_role.sql"
)

_bootstrapped: set[str] = set()


def _bootstrap_supabase_shape(using: str, **_kwargs: Any) -> None:
    connection = connections[using]
    if connection.settings_dict["NAME"] in _bootstrapped:
        return
    with connection.cursor() as cursor:
        cursor.execute(STUB_SQL.read_text())
        cursor.execute(PLATFORM_ROLE_MIGRATION.read_text())
    _bootstrapped.add(connection.settings_dict["NAME"])


pre_migrate.connect(_bootstrap_supabase_shape, dispatch_uid="platform-tests-supabase-shape")
