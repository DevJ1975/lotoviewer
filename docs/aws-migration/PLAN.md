# Soteria Field → AWS migration plan

**Goal:** run Soteria Field entirely on AWS, built in parallel while Vercel and
Supabase keep serving production. When the AWS copy is ready, point the domain
at it. Vercel and Supabase stay untouched until AWS has run cleanly.

**Not doing:** rewriting the app in another language. The 299 pages, 359 API
routes and the shared `packages/core` stay TypeScript/Next.js; Python stays for
the existing `photo-walkdown` and `sds-parser` services.

## Ground rules

1. Production is never modified by this work.
2. One codebase, two backends: thin adapters around the four Supabase-specific
   areas (database client, auth, storage, realtime), chosen per environment by
   an env var. No long-lived `aws` branch.
3. Everything is Terraform (`infra/aws`). Separate AWS accounts for dev, staging
   and prod. Budget alerts exist before any other resource.

## Service map

| Today | AWS |
| --- | --- |
| Vercel (Next.js 16) | ECS Fargate + ALB + ECR, behind CloudFront |
| 29 Vercel crons | EventBridge Scheduler → `/api/cron/*` with `CRON_SECRET` |
| Supabase Postgres | RDS for PostgreSQL (pgvector, pg_trgm, pgcrypto, pg_cron) |
| `pg_net` webhooks (migrations 013, 018, 100, 126) | Outbox table + SQS + worker |
| Supabase Auth | Cognito + Lambda triggers (migrate users on first login, add role claim) |
| Supabase Storage (10 buckets) | S3 + CloudFront, per-tenant key prefixes, presigned URLs |
| Supabase Realtime (6 files) | AppSync Events / API Gateway WebSocket, or polling first |
| PostgREST API layer | PostgREST on Fargate (spike) or server-side API routes |
| Resend | SES (domain verification, production access) |
| Env secrets | Secrets Manager / SSM Parameter Store |
| DNS + certs | Route 53 + ACM |
| Logs | CloudWatch (Sentry may stay) |
| photo-walkdown, sds-parser | ECS Fargate services |
| Deploys | GitHub Actions + OIDC |

## The hard part: 445 RLS policies

Tenant isolation lives in RLS policies that call `auth.uid()` (46 migration
files). Plan: create an `auth` compatibility schema on RDS (`auth.uid()`,
`auth.jwt()`, `auth.role()`) plus the `anon` / `authenticated` / `service_role`
roles, so the existing policies keep working, and verify with a spike (phase 2).
Check early for foreign keys to `auth.users`.

## Phases

| # | Goal | Done when |
| --- | --- | --- |
| 0 | Foundations: accounts, SSO, budget, IaC, GitHub OIDC | An infra change validates (and plans) in CI |
| 1 | Network + RDS + `auth` shim; all migrations apply | Migrations run on RDS; drift check passes |
| 2 | Cognito + PostgREST spike | A Cognito user sees only their tenant's rows |
| 3 | App on Fargate at `aws.soteriafield.app` | App loads and logs in on AWS |
| 4 | S3 buckets, storage adapter, copy of existing files | Placards and photos load from S3 |
| 5 | EventBridge crons, outbox + SQS webhooks, SES | All 29 crons fire; webhooks and email deliver |
| 6 | Realtime replacement, Python services, mobile config | Feature-parity checklist passes |
| 7 | Rehearsal: restore a fresh production copy and run smoke tests | Full rehearsal passes more than once |
| 8 | Cutover | Domain points at AWS |

## Cutover and rollback

Lower the DNS TTL days ahead → freeze writes on Supabase → final dump → restore
to RDS, sync storage to S3, migrate users to Cognito → smoke test on the AWS
hostname → switch DNS. Rollback is pointing DNS back at Vercel; writes made on
AWS after the switch would not exist on Supabase, so keep the window short.

Ship a mobile app update that can reach AWS **before** cutover (store review
adds lag), and repoint `photo-walkdown` (it writes to Supabase with the
service-role key today).

## Open items

- Region defaults to `us-west-2`; change it in the Terraform variables if the
  customer's location argues for another.
- Credits (about $100–$200 on the Free Tier) will not cover a months-long full
  stack. Plan to move to a paid account.
