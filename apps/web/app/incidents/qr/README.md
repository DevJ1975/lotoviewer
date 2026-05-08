# QR-token anonymous reporting

This module owns the public anonymous incident-reporting channel.
Workers scan a posted QR code, hit `/report/<token>`, and submit a
report with no login. Admins manage the tokens at `/incidents/qr`.

## Files at a glance

| Surface                                           | Path                                                       |
| ------------------------------------------------- | ---------------------------------------------------------- |
| Admin list (CRUD + realtime + sparkline + edit)   | `app/incidents/qr/page.tsx`                                |
| Public report form                                | `app/report/[token]/page.tsx`                              |
| Public status lookup (receipt PIN)                | `app/report/status/page.tsx`                               |
| Token CRUD API                                    | `app/api/incidents/qr-tokens/route.ts`                     |
| Activity sparkline API                            | `app/api/incidents/qr-tokens/activity/route.ts`            |
| Public verify (form bootstrap)                    | `app/api/anonymous-report/verify/[token]/route.ts`         |
| Public submit                                     | `app/api/anonymous-report/route.ts`                        |
| Public attachment register                        | `app/api/anonymous-report/attach/route.ts`                 |
| Public status lookup                              | `app/api/anonymous-report/status/route.ts`                 |
| Abuse / locale / receipt / geofence helpers       | `lib/anonReport/*.ts`                                      |
| Migrations                                        | `apps/web/migrations/0{67,68,81,82,83,84,85,86,87}_*.sql`  |

## Defence-in-depth

The public submit endpoint is the only route in the app that runs
without `requireTenantMember`. It carries five overlapping
protections — DON'T weaken any one of them without replacing it.

1. **Token must exist + be `enabled = true`.**
   Service-role lookup; same 403 response for unknown vs disabled
   so probes can't enumerate.
2. **Per-token rate limit** (`rate_limit_per_hour`).
   Bounded by a count query against `incidents.anon_token_id`.
3. **Per-IP cooldown** (migration 085).
   Rolling 10-minute window keyed on `sha256(ip || daily_salt)`.
   Rotates daily; raw IPs are never persisted.
4. **Optional Turnstile captcha** (migration 086).
   Off by default. Lazy-loaded so the third-party script only
   fires for tokens whose admin opted in.
5. **Optional geofence** (migration 086).
   Mismatches are flagged on the incident, **never rejected**. A
   real safety report shouldn't hinge on a GPS fix.

## Anonymity guarantees

We deliberately do NOT store:

- raw IP addresses (only hashed, salted, daily-rotated)
- the receipt PIN (only `sha256(report_number || pin)`)
- any reference between an authenticated session and an anonymous
  report (the form runs with no session)

The status-lookup endpoint deliberately returns ONLY:

- status (open / investigating / closed)
- submission timestamp
- `anon_public_status_note` if the safety team published one

It never returns the description, location, or attachments. The
PIN holder may not be the original reporter — assume PIN
disclosure to a coworker.

## Adding new admin actions

Every mutation on a token row should write a `qr_token_audit_log`
entry via `lib/anonReport/audit.ts:writeQrTokenAudit`. The
`event_type` enum is in migration 087; extend it (and the helper's
type) together.

## Local development

- `TURNSTILE_SECRET_KEY` unset → captcha verifies as ok in dev.
  In production the absence of the secret is treated as misconfig
  and rejects.
- `ANON_IP_SALT` unset → fallback constant; rotation is still daily
  but the salt is predictable. Set this in any deployed env.
- The `loto-photos` storage bucket must exist (migration 033).
  Anonymous report attachments live under
  `<tenant>/anonymous-reports/<incident_id>/`.
