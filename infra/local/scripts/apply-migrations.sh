#!/bin/sh
# Applies the numbered application migrations, in filename order, to
# $DATABASE_URL and remembers which ones ran so a re-run only does new work.
#
# Skipped on purpose: seed_*.sql (demo data) and data_hygiene_*.sql (one-off
# fixes for a specific customer's production data). Neither is part of the schema.
#
# Stops at the first failure and names the file, because a later migration
# built on a failed one only produces misleading errors.
set -eu

migrations_dir=${MIGRATIONS_DIR:-/migrations}

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists local_dev;
create table if not exists local_dev.applied_migrations (
  filename   text primary key,
  applied_at timestamptz not null default now()
);
SQL

applied=0
skipped=0
for filename in $(ls "$migrations_dir" | grep -E '^[0-9]{3}[a-z]?_.*\.sql$' | LC_ALL=C sort); do
  already=$(psql "$DATABASE_URL" -At -v ON_ERROR_STOP=1 \
    -c "select 1 from local_dev.applied_migrations where filename = '$filename'")
  if [ -n "$already" ]; then
    skipped=$((skipped + 1))
    continue
  fi

  if ! psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$migrations_dir/$filename" >/dev/null; then
    echo "FAILED: $filename (after $applied applied, $skipped already applied)" >&2
    exit 1
  fi

  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q \
    -c "insert into local_dev.applied_migrations (filename) values ('$filename')"
  applied=$((applied + 1))
done

echo "migrations: $applied applied, $skipped already applied"
