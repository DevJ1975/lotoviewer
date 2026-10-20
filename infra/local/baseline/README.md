# Baseline schema

The numbered migrations in `apps/web/migrations` are not a complete history:
`loto_equipment`, `loto_energy_steps`, `loto_hygiene_log`,
`compliance_obligation_completions` and a few other tables were created outside
them. To rebuild the database locally (and on AWS), start from a snapshot of the
live schema.

## Take the snapshot (structure only, no rows)

Use a **read-only** connection string (Supabase Dashboard → Connect → Direct
connection), and a `pg_dump` at least as new as the server (17 or later).

```bash
export SUPABASE_DB_URL='postgres://…'     # do not commit or paste this

pg_dump "$SUPABASE_DB_URL" --schema-only --schema=public \
  --no-owner --no-privileges --file=schema.sql

psql "$SUPABASE_DB_URL" -At \
  -c "select version || '|' || name from supabase_migrations.schema_migrations order by version" \
  > ledger.txt
```

`--schema-only` exports table definitions, indexes, policies, functions and
triggers, and no customer rows. `ledger.txt` is only the list of migration names
production has applied, so the local runner knows which numbered migrations the
snapshot already contains.

## Before sharing

Open `schema.sql` and scan it for anything that should not leave your hands, such
as a hard-coded URL or key inside a function body. Then put both files in this
folder and push them to the branch.
