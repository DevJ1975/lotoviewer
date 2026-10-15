# Soteria platform service (Django)

A Python service that runs **alongside Supabase** — it does not replace it.
Supabase stays the system of record (Auth, Storage, Realtime, RLS, and the SQL
migrations in `apps/web/migrations`). Next.js stays the edge: browsers and the
mobile app never call this service.

This service takes the work that does not belong in a Vercel request:

| Phase | Capability | Status |
| --- | --- | --- |
| 0 | Foundation: unmanaged models, tenant guard, RLS impersonation, CI | ✅ shipped |
| 1 | Internal ops admin (SSO + 2FA), AI usage/cost, review queues | planned |
| 2 | Durable job runner (Procrastinate) replacing the `*-resume` crons | planned |
| 3 | Prompt/model registry + AI eval harness | planned |
| 4 | Document ingestion + OCR (absorbs `services/sds-parser`) | planned |
| 5 | Precomputed `analytics.*` read models for slow dashboards | planned |
| 6 | Python predictive-risk models (shadow mode; LLMs only narrate) | planned |
| 7 | Tenant-scoped MCP server | planned |

## How it fits together

```
Browser / mobile ──► Next.js (Vercel) ──► Supabase Postgres ◄── Django (Fly.io)
                                              ▲   public  : owned by apps/web/migrations
                                              │   platform: owned by Django migrations
```

* Django connects to the same Postgres as the **`platform_svc` role** created by
  migration `294_platform_service_role.sql` — never the service-role key.
* `search_path = platform, public`: Django's own tables land in `platform`;
  Supabase tables are read through **unmanaged models** (`tenancy/models.py`)
  that Django never migrates or writes.

## Tenant isolation — read this before writing a query

There are exactly two ways to touch tenant-owned data:

1. **As a user** — `tenancy.rls.rls_session(claims, active_tenant_id=...)`.
   Replays the user's verified JWT claims and `x-active-tenant` /
   `x-active-facility` headers inside a transaction running as
   `authenticated`, so **Supabase RLS applies exactly as it does for
   PostgREST**. Get claims only from `tenancy.auth.verify_supabase_jwt`.

2. **As the system** (workers, rollups) — tenant-owned models use
   `TenantScopedQuerySet`, which **refuses to execute** unless the query is
   scoped to a single tenant:

   ```python
   Facility.objects.for_tenant(tenant_id)  # ✅
   Facility.objects.filter(tenant_id=tenant_id)  # ✅
   tenant.facilities.all()  # ✅
   Facility.objects.all()  # ❌ UnscopedTenantQueryError
   Facility.objects.across_all_tenants(reason="ops rollup")  # ✅ deliberate, logged
   ```

`platform_svc` can only **read** the tables migration 294 grants, and its
membership in `authenticated` is `NOINHERIT`, so it gains nothing from that
role outside an explicit `rls_session()`. New tables are granted by new
Supabase migrations, one table at a time.

## Local development

Requires [uv](https://docs.astral.sh/uv/) and PostgreSQL ≥ 16.

```bash
cd services/platform
uv sync
cp .env.example .env          # then edit

# Tests run against a real Postgres: the test DB is shaped like Supabase
# (tests/sql/supabase_stub.sql) and the real migration 294 is applied.
DJANGO_SECRET_KEY=test DATABASE_URL=postgres://postgres@localhost:5432/platform_dev \
  uv run pytest

uv run ruff check . && uv run ruff format --check . && uv run mypy .
```

## Database role (one-time, per Supabase project)

1. Apply `apps/web/migrations/294_platform_service_role.sql` like any other
   migration. It creates `platform_svc` as `NOLOGIN` — no secret lives in git.
2. In the Supabase SQL editor, with a password from your secret manager:

   ```sql
   alter role platform_svc with login password '<generated>';
   ```

3. Connect through **Supavisor session mode** (port 5432). Transaction mode
   (6543) discards startup options and is not supported.

## Deploy (Fly.io)

```bash
cd services/platform
fly launch --no-deploy --copy-config          # first time only
fly secrets set \
  DJANGO_SECRET_KEY="$(python -c 'import secrets;print(secrets.token_urlsafe(50))')" \
  DATABASE_URL='postgres://platform_svc.<ref>:<pw>@<pooler-host>:5432/postgres' \
  SUPABASE_URL='https://<ref>.supabase.co' \
  SENTRY_DSN='...'
fly deploy
```

`release_command` runs `migrate`, which only touches the `platform` schema.
CI (`.github/workflows/platform-service.yml`) lints, type-checks and tests on
every PR touching this service; deploy is a manual `workflow_dispatch` until
the role and secrets exist in production.

The Django admin is **not mounted** (`DJANGO_ADMIN_ENABLED=false`) until
Phase 1 puts SSO + 2FA in front of it.
