# STRIKE WLS demo — hand-off

Goal: LOTO 101 live for the **WLS Demo** tenant (0002, `ddddbce8-c7ab-4855-8bcd-821d080617ee`)
on the production Supabase project, with LOTO 101 required before WLS hot-work permits.
Other tenants are untouched: migrations are global, data is tenant-owned.

## What a cloud session cannot do (and why the steps below are shaped this way)

- **No Postgres from a cloud session.** The egress proxy supports HTTPS on 443 only; raw-TCP
  databases and non-443 ports are unsupported. `scripts/strike-demo-wls.sh` (psql-based) is for a
  machine with `psql`, e.g. a laptop.
- **The Supabase connector cannot apply these migrations.** Its `apply_migration` holds
  `drop … if exists` / `revoke` statements for a confirmation that never surfaces in Claude Code,
  and times out after 60 s without applying anything. DML (`insert`/`update`) runs fine.
- **The Supabase REST host must be allowed** in the environment's network policy for the studio's
  import, render-upload and approval commands (they use PostgREST + Storage over HTTPS).

## One-time, by a human

1. **Migrations 294–299** → paste `apps/web/migrations/29{4..9}_*.sql` in order into the Supabase
   SQL editor (every statement is idempotent). Known effects:
   - published STRIKE versions become frozen (edit = new version);
   - WLS's existing `loto` requirement (LOTO Refresher) becomes a hard gate on WLS LOTO group
     permits — deactivate it in STRIKE → Training admin if that is unwanted;
   - Snak King has no requirements, so nothing changes for them.
2. **Environment secret** `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Project Settings → API keys).
3. **Network policy**: allow `zwtnpyjifbdytlektxlc.supabase.co`.
4. **Vercel preview env** `STRIKE_KIOSK_SECRET` (≥ 32 random characters) so "Train now" links work.

## Then, from a new cloud session

```bash
cd services/learning-studio && pip install -r requirements.txt
export SUPABASE_URL=https://zwtnpyjifbdytlektxlc.supabase.co
export SUPABASE_ANON_KEY=<publishable anon key — Supabase connector get_publishable_keys>
export DJANGO_SECRET_KEY="$(python3 -c 'import secrets;print(secrets.token_urlsafe(50))')" DJANGO_DEBUG=1 DJANGO_SSL_REDIRECT=0
T=ddddbce8-c7ab-4855-8bcd-821d080617ee
python manage.py migrate -v0
python manage.py import_seed_module seed/loto-101 --tenant $T
python manage.py render_module seed/loto-101 --burn-captions --upload --tenant $T
python manage.py approve_media seed/loto-101 --tenant $T --approver <reviewer email>
```

Then run steps 4–5 of `scripts/strike-demo-wls.sh` (the unapproved-asset guard, publish, tenant
settings upsert, hot-work requirement) as plain SQL through the Supabase connector, substituting
the tenant id and slug `loto-101`.

Verify signed in as a WLS Demo user on the PR preview: play `/strike/loto-101`, pass the quiz, get
the certificate; start a hot-work permit and watch the training panel gate it.
