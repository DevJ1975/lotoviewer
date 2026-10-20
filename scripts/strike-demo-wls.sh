#!/usr/bin/env bash
# Stand up the STRIKE / LOTO 101 demo for one tenant (default: WLS Demo #0002).
#
#   1. Apply migrations 294–299 (idempotent; safe to re-run).
#   2. Import LOTO 101 as a module OWNED BY THAT TENANT (other tenants never see it).
#   3. Render the downloadable MP4 and attach it.
#   4. Approve the AI media as the named reviewer, then publish.
#   5. Require LOTO 101 before that tenant's hot-work permits (permit gate demo).
#
# Required env:
#   SUPABASE_URL               https://<ref>.supabase.co
#   SUPABASE_ANON_KEY
#   SUPABASE_SERVICE_ROLE_KEY
#   DEMO_APPROVER              email of the person who reviewed the media
#   Database — one of:
#     SUPABASE_DB_URL          full postgres URI (Supabase → Connect → Session pooler), or
#     SUPABASE_DB_PASSWORD     the database password, with
#     SUPABASE_DB_HOST         the Session pooler host (aws-N-<region>.pooler.supabase.com).
#                              The pooler user is postgres.<ref>; the password travels via
#                              PGPASSWORD, so it never needs URL-encoding.
# Optional env:
#   DEMO_TENANT_NUMBER (0002)  SUPABASE_DB_PORT (5432)  SKIP_RENDER=1  SKIP_GATE=1
set -euo pipefail

: "${SUPABASE_URL:?}" "${SUPABASE_ANON_KEY:?}" "${SUPABASE_SERVICE_ROLE_KEY:?}" "${DEMO_APPROVER:?}"
if [ -n "${SUPABASE_DB_URL:-}" ]; then
  PSQL_CONN="$SUPABASE_DB_URL"
else
  : "${SUPABASE_DB_PASSWORD:?set SUPABASE_DB_URL, or SUPABASE_DB_PASSWORD and SUPABASE_DB_HOST}" "${SUPABASE_DB_HOST:?}"
  PROJECT_REF="$(sed -E 's#^https?://([^.]+)\..*#\1#' <<<"$SUPABASE_URL")"
  export PGPASSWORD="$SUPABASE_DB_PASSWORD"
  PSQL_CONN="host=$SUPABASE_DB_HOST port=${SUPABASE_DB_PORT:-5432} user=postgres.$PROJECT_REF dbname=postgres sslmode=require"
fi
TENANT_NUMBER="${DEMO_TENANT_NUMBER:-0002}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STUDIO="$ROOT/services/learning-studio"
SEED="$STUDIO/seed/loto-101"
SLUG="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["slug"])' "$SEED/module.json")"
psql_() { psql "$PSQL_CONN" -X -v ON_ERROR_STOP=1 -q "$@"; }

echo "== 1/5 Migrations"
for f in "$ROOT"/apps/web/migrations/{294,295,296,297,298,299}_*.sql; do
  echo "   applying $(basename "$f")"
  psql_ -f "$f"
done

TENANT_ID="$(psql_ -tA -c "select id from public.tenants where tenant_number = '$TENANT_NUMBER'")"
[ -n "$TENANT_ID" ] || { echo "No tenant numbered $TENANT_NUMBER" >&2; exit 1; }
echo "   tenant $TENANT_NUMBER = $TENANT_ID"

echo "== 2/5 Import LOTO 101 for tenant $TENANT_NUMBER"
export DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-cli-$(openssl rand -hex 24)}" DJANGO_DEBUG=1 DJANGO_SSL_REDIRECT=0
export STUDIO_DATA_DIR="${STUDIO_DATA_DIR:-$STUDIO/data}"
mkdir -p "$STUDIO_DATA_DIR"
manage() { (cd "$STUDIO" && python manage.py "$@"); }
manage migrate -v0
manage import_seed_module "$SEED" --tenant "$TENANT_ID"

if [ "${SKIP_RENDER:-}" != "1" ]; then
  echo "== 3/5 Render + attach MP4"
  manage render_module "$SEED" --burn-captions --upload --tenant "$TENANT_ID"
fi

echo "== 4/5 Approve media as $DEMO_APPROVER and publish"
manage approve_media "$SEED" --tenant "$TENANT_ID" --approver "$DEMO_APPROVER"
# Publish only when nothing AI-generated is left unapproved (the publish preflight's rule).
UNAPPROVED="$(psql_ -tA -v tenant="$TENANT_ID" -v slug="$SLUG" <<'SQL'
select count(*)
  from public.strike_module_versions v
  join public.strike_modules m on m.id = v.module_id
  cross join lateral jsonb_array_elements(v.content -> 'blocks') b
  cross join lateral (values (b -> 'image'), (b -> 'narration')) assets(a)
 where m.slug = :'slug' and m.tenant_id = :'tenant'::uuid
   and v.status in ('draft', 'in_review')
   and jsonb_typeof(assets.a) = 'object'
   and coalesce((assets.a ->> 'ai_generated')::boolean, false)
   and coalesce(assets.a ->> 'approved_at', '') = '';
SQL
)"
[ "$UNAPPROVED" = "0" ] || { echo "$UNAPPROVED AI asset(s) still unapproved; refusing to publish" >&2; exit 1; }
psql_ -v tenant="$TENANT_ID" -v slug="$SLUG" <<'SQL'
begin;
update public.strike_module_versions v
   set status = 'published', published_at = now()
  from public.strike_modules m
 where m.id = v.module_id and m.slug = :'slug' and m.tenant_id = :'tenant'::uuid
   and v.status in ('draft', 'in_review');
update public.strike_modules
   set status = 'published', published_at = coalesce(published_at, now())
 where slug = :'slug' and tenant_id = :'tenant'::uuid;
insert into public.strike_tenant_settings (tenant_id) values (:'tenant'::uuid)
on conflict (tenant_id) do nothing;
commit;
SQL

if [ "${SKIP_GATE:-}" != "1" ]; then
  echo "== 5/5 Require LOTO 101 before hot-work permits (tenant $TENANT_NUMBER only)"
  psql_ -v tenant="$TENANT_ID" -v slug="$SLUG" <<'SQL'
insert into public.strike_training_requirements
  (tenant_id, module_id, source_type, required_before_start, expires_after_days, active, notes)
select :'tenant'::uuid, m.id, 'hot_work', true, null, true, 'STRIKE demo: LOTO 101 before hot work'
  from public.strike_modules m
 where m.slug = :'slug' and m.tenant_id = :'tenant'::uuid
   and not exists (
     select 1 from public.strike_training_requirements r
      where r.tenant_id = :'tenant'::uuid and r.module_id = m.id and r.source_type = 'hot_work');
SQL
fi

psql_ -v tenant="$TENANT_ID" -v slug="$SLUG" -c "
select m.title, m.status, v.version_number, v.status as version_status, v.download_path is not null as has_mp4,
       (select count(*) from public.strike_quiz_questions q where q.module_version_id = v.id) as questions,
       (select count(*) from public.strike_training_requirements r where r.module_id = m.id and r.active) as gates
  from public.strike_modules m join public.strike_module_versions v on v.module_id = m.id
 where m.slug = :'slug' and m.tenant_id = :'tenant'::uuid;"
echo "Done. Sign in as a tenant $TENANT_NUMBER user and open /strike/$SLUG"
