# AWS Soteria Field — local stack

A Docker Compose stand-in for the AWS deployment described in
[`docs/aws-migration/PLAN.md`](../../docs/aws-migration/PLAN.md). It lets the
database, API layer, file storage and mail be built and tested on a laptop with
no AWS bill. Production on Vercel and Supabase is untouched.

```bash
cd infra/local
docker compose up -d          # start everything
docker compose down -v        # stop and delete all local data
```

Everything binds to `127.0.0.1` and uses throwaway credentials.

| Service | Stands in for (AWS) | Port | Notes |
| --- | --- | --- | --- |
| `postgres` | RDS PostgreSQL | 54322 | `pgvector/pgvector:pg17`, database `soteria` |
| `migrate` | the deploy-time migration step | — | Applies the numbered migrations once, in order |
| `postgrest` | PostgREST on Fargate | 54321 | Waits for `migrate` to succeed |
| `s3` | S3 | 8333 | SeaweedFS; `create-buckets` makes the 11 buckets |
| `mailpit` | SES | 8025 (UI), 1025 (SMTP) | Catches outgoing mail |

Credentials for the S3 store are `local-access-key` / `local-secret-key`. Point
any S3 client at `http://127.0.0.1:8333`:

```bash
AWS_ENDPOINT_URL=http://127.0.0.1:8333 AWS_ACCESS_KEY_ID=local-access-key \
AWS_SECRET_ACCESS_KEY=local-secret-key AWS_DEFAULT_REGION=us-west-2 aws s3 ls
```

## Supabase compatibility layer

The migrations were written for Supabase, so `postgres/init/compat/supabase-compat.sql`
supplies the few objects they assume exist: the `anon` / `authenticated` /
`service_role` roles, `auth.users`, `auth.uid()`, the `storage` metadata tables,
and stubs for `pg_cron` and `pg_net`. It runs once, when the data volume is first
created. These stand-ins exist only so the historical migrations apply; on AWS
the real services take over (Cognito, S3, pg_cron on RDS, an outbox + queue).

## Known gap: no baseline schema yet

`docker compose up` currently stops at **migration 002**. The numbered migrations
are not a complete history: `loto_equipment`, `loto_energy_steps`,
`loto_hygiene_log`, `compliance_obligation_completions` and a few more tables
were created outside them (by hand in the Supabase dashboard) and are only ever
altered. A baseline schema taken from the live database has to be applied first.
Until then, `postgres`, `s3`, `create-buckets` and `mailpit` run; `migrate` stops
at 002 and `postgrest` never starts.

## Why SeaweedFS and not MinIO

MinIO's public Docker images are no longer published, so the S3 stand-in is
SeaweedFS (Apache-2.0). `create-buckets` uses the real AWS CLI, so the calls it
makes are the same ones the AWS deployment will make.

## Bucket list

Union of buckets the code uses and buckets the migrations insert.
`loto-photos`, `policy-uploads` and `fleet-docs` are not created by any
migration, so the real AWS infrastructure must create them explicitly.
