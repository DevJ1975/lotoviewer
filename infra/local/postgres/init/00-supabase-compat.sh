#!/bin/sh
# Runs once, when the data volume is first created. A shell wrapper rather than
# a bare .sql file so the authenticator password can come from the environment.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v authenticator_password="$AUTHENTICATOR_PASSWORD" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -f /docker-entrypoint-initdb.d/compat/supabase-compat.sql
