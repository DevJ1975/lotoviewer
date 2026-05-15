# Toolbox Talks module — handoff — 2026-05-08

**Status:** Code is on `main` (merge commit `3befdea`). Migrations 069 and 070 are applied to Supabase (`Soteria Main Project`, `zwtnpyjifbdytlektxlc`). The cron is registered in `vercel.json` and will fire every Sunday at 05:00 UTC. **One thing left for the human**: trigger the cron once now so the first week of talks is generated without waiting for Sunday.

This document hands off the result of the toolbox-talks build session to whoever picks up next. It exists so the next agent or operator knows what's done, what's left, and what gotchas to avoid.

---

## TL;DR

- Three commits on `main` (squashed via `--no-ff` merge `3befdea`):
  1. `109f87a` feat — schema, cron, API, pages, 100 seed topics
  2. `ff5600d` chore — first devjr audit (1 real bug, 4 defensive, +35 tests)
  3. `fe1bcb5` chore — second devjr audit (cron disabled-tenant filter, migration 070 audit-trail column, defensive guards)
- `tsc` clean, **1919 / 1919** vitest pass, production build clean.
- Migrations 069 and 070 applied. `toolbox_topics` has 100 seeded General Industry rows.
- Module shipped enabled-by-default per FEATURES catalog. Per-tenant disable via `tenants.modules->>'toolbox-talks' = 'false'`.

---

## What's left (action item for the next person)

**Trigger the weekly cron once to backfill the first 14 days of talks for every active tenant.** Without this, the `/toolbox-talks` page renders the empty "no talk scheduled for today yet" state until the next scheduled run on Sunday 05:00 UTC.

```bash
curl -X POST "https://soteriafield.app/api/cron/generate-toolbox-talks" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response:

```json
{
  "tenants_scanned": 2,
  "talks_generated": 14,
  "talks_failed": 0,
  "per_tenant": [
    { "tenant_id": "...", "generated": 7, "skipped": 0, "failed": 0 },
    { "tenant_id": "...", "generated": 7, "skipped": 0, "failed": 0 }
  ]
}
```

`CRON_SECRET` is in Vercel env vars (Production scope). It is shared across all 11 cron routes; do not paste it into chat transcripts.

After it fires, verify via Supabase:

```sql
select tenant_id, talk_date, title, length(body_markdown) as body_len, ai_model
from public.toolbox_talks
order by tenant_id, talk_date;
```

You should see 14 rows per active tenant, each with a distinct `talk_date` covering today + 13, body lengths typically 1500–8000 chars, `ai_model = 'claude-sonnet-4-6'`, `generated_by = 'cron'`.

---

## What was built

### Schema (migrations 069 + 070)

Three new tables, all in the `public` schema:

| Table | Tenant-scoped? | RLS | Notes |
|---|---|---|---|
| `toolbox_topics` | No (global library) | enabled, **no policies** (intentional — locked closed; only the cron's service-role reads it) | 100 General Industry seed rows. `industry text` check constraint accepts `general / construction / food / oil_gas / maritime`. v1 ships only `general`. |
| `toolbox_talks` | Yes (`tenant_id`) | tenant_scope policy via `active_tenant_id()` + `current_user_tenant_ids()` + `is_superadmin()` | Unique `(tenant_id, talk_date)` makes the cron idempotent. AI-generated content is snapshotted at generation time so a topic edit doesn't retroactively change a delivered talk. |
| `toolbox_talk_signatures` | Yes (`tenant_id`) | tenant_scope policy | Unique `(talk_id, signer_user_id)` blocks self-double-sign; coworker signs (signer_user_id NULL) can stack. `inserted_by` column (migration 070) audit-records the supervisor who held the tablet, separate from `signer_user_id`. |

### Cron — `/api/cron/generate-toolbox-talks`

- File: `apps/web/app/api/cron/generate-toolbox-talks/route.ts`
- Schedule: `0 5 * * 0` (Sundays 05:00 UTC = 00:00 EST / 01:00 EDT) via `apps/web/vercel.json`.
- Auth: same `safeEqual(bearer, CRON_SECRET)` posture as the other 10 crons.
- Behavior: for every tenant with `disabled_at IS NULL` AND module enabled, fills the next 14 days of missing talks. Topic rotation extracted into `apps/web/lib/toolboxRotation.ts` for unit testability — picks unused topics least-recently-delivered first, cycles through the pool.
- Per-tenant Anthropic key honored via `getTenantApiKey(tenant.id)` — same posture as the LOTO/CS generation routes.

### API routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/toolbox-talks` | GET | `requireTenantMember` | Today + upcoming 13 + last 30 with sign-in counts. |
| `/api/toolbox-talks/[id]` | GET | `requireTenantMember` | Single talk + roster. |
| `/api/toolbox-talks/[id]/sign` | POST | `requireTenantMember` | Add a signature (self or coworker). |

There is intentionally **no client-facing generate endpoint** — the operator's call. Workers and admins read + sign; only the cron creates talks.

### Pages

- `/toolbox-talks` — list (today's featured, upcoming, recent) — `apps/web/app/toolbox-talks/page.tsx`
- `/toolbox-talks/[id]` — body + key points + cue card + sign-in modal — `apps/web/app/toolbox-talks/[id]/page.tsx`
- `apps/web/app/toolbox-talks/layout.tsx` — `ModuleGuard moduleId="toolbox-talks"`

### Module registration

- `packages/core/src/features.ts` — added `toolbox-talks` (top-level safety category, `enabled: true`).
- `apps/web/__tests__/lib/features.test.ts`, `landing.test.ts`, and `app/_components/ModulesGrid.test.tsx` updated to include the new module in fixtures.

### Tests added (35)

- `__tests__/lib/markdown.test.ts` — 18 cases for the new `renderTalkMd` (XSS, h3, bullets, links, unicode subscripts, edge cases).
- `__tests__/lib/toolboxRotation.test.ts` — 18 cases for the rotation helpers (never-used precedence, date sort, tie-break, no-mutation, idempotency, cycling, two-week simulation).

### Smoke test doc

`docs/toolbox-talks-smoke-test.md` — manual verification checklist for SignaturePad on real touch devices, cross-tenant isolation, and the bits that automation can't drive.

---

## Gotchas

1. **`toolbox_topics` RLS has no policies.** This is intentional and called out in the migration comment + the security advisor will flag it as `rls_enabled_no_policy` (INFO level). The cron uses `supabaseAdmin()` (service role) which bypasses RLS; tenants don't query it directly. Do **not** add a policy "to silence the advisor" — that would expose the topic catalog to every signed-in user, which was the abuse-prevention concern that led to this design.

2. **Pre-existing `ALLOW_DEEPLINK_PLACEHOLDERS=1` is required to run `npm run build` locally**, because the prebuild script `scripts/check-deeplink-placeholders.mjs` exits 1 on the still-present mobile placeholders. This is documented in `docs/handoffs/2026-05-05-vercel-production.md` and not introduced by this work.

3. **Cron generation can take a while at scale.** For each tenant needing 7 talks, 7 sequential Anthropic calls × 3-5s each = 21-35 seconds. The route has `maxDuration = 300` (5 min). At ~10 tenants this is fine; beyond that, parallelize per tenant or shard the cron — noted in the route's comments.

4. **Topic rotation is per-tenant.** The cron tracks "last used" per tenant, not globally. Two tenants can be assigned the same topic on the same day. That's by design — every tenant is independent.

5. **The `lastUsed` lookup limits to 500 most recent talks per tenant.** A tenant who's been on the system for over 71 weeks (500/7) and has more than 500 historical talks will see topics older than that show up as "never used" again — which is fine, the rotation will just cycle them in.

6. **Industry fallback is `'general'`.** Superadmin can set `tenants.settings.toolbox_industry` to `general` or `construction`. Unknown legacy values normalize to `general`; if the selected pack has no active topics, the cron falls back to `general` with a warning Sentry event.

7. **Coworker signs allow duplicates.** The unique constraint allows multiple NULL `signer_user_id` per talk. The UI disables the button while submitting, but a network glitch + double-tap could insert two identical-name rows. This is acceptable for v1 — the audit trail is preserved through `inserted_by` so disputes can be resolved.

8. **`inserted_by` is nullable.** Migration 070 added it without backfilling. Any rows inserted between migrations 069 and 070 (none expected — table was brand new) would have NULL there. Going forward, the `/sign` API always populates it.

---

## Project / branch references

- Repo: `DevJ1975/lotoviewer`
- Default branch: `main` at `3befdea`
- Feature branch (kept in case of rollback need): `claude/toolbox-talks-signin-module-vGU46` at `fe1bcb5` — delete after a clean week of cron runs.
- Supabase project: `Soteria Main Project` / `zwtnpyjifbdytlektxlc` (us-east-2).
- Migrations applied: through 070.
- Vercel project: see `docs/handoffs/2026-05-05-vercel-production.md` for IDs.

---

## What I checked and what's still unverified

| | Status |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` | 1919 / 1919 |
| `npm run build` (production) | clean (with `ALLOW_DEEPLINK_PLACEHOLDERS=1`) |
| Migrations applied to remote Supabase | yes, both 069 + 070 |
| 100 seed topics present | yes |
| Cron actually fires Sonnet and round-trips a JSON-schema response | **NOT tested** — needs the manual cron trigger above |
| SignaturePad on a real iPad / mobile Safari | **NOT tested** — only ran in jsdom |
| Cross-tenant isolation by direct API call | **NOT tested** — relies on RLS + the `.eq('tenant_id', gate.tenantId)` filter, both audited but not exercised |
| First-real-Anthropic-call cost | **unknown** — Sonnet 4.6 with `max_tokens: 4000`, 7 calls per tenant per week. At Anthropic's published rates that's roughly $0.20-0.50 per tenant per week. Confirm against the AI usage dashboard after the first run. |

The smoke checklist in `docs/toolbox-talks-smoke-test.md` covers everything in the "NOT tested" rows.
