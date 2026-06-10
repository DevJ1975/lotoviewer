# TODOs — items needing your manual input

_Last updated: 2026-05-23. Generated from the scorecard + email-deliverability work._

## 1. DNS / email deliverability (highest impact — do first)
Add these records for `soteriafield.app` in your DNS provider, then verify in Resend.
This is ~80% of "emails land in spam" and I can't do it from here.

- [ ] In **Resend → Domains → Add `soteriafield.app`**, copy the generated records:
  - [ ] **SPF** — `TXT` on the MAIL FROM subdomain Resend shows (e.g. `send`), value = the exact `v=spf1 include:…` string.
  - [ ] **DKIM** — `CNAME`/`TXT` named like `resend._domainkey` (exact name from Resend). **Most important record** — copy verbatim.
- [ ] Add **DMARC** — `TXT` on `_dmarc`, value: `v=DMARC1; p=none; rua=mailto:dmarc@soteriafield.app; adkim=s; aspf=s`
- [ ] Wait for Resend to show the domain **Verified** (minutes–hours).
- [ ] After ~1–2 weeks of clean DMARC reports, tighten policy: `p=none` → `p=quarantine` → `p=reject`.
- [ ] _Optional:_ send from a dedicated subdomain (e.g. `notify.soteriafield.app`) to isolate transactional reputation from corporate mail.

> Once these are live, ask me to run DNS lookups to sanity-check SPF/DKIM/DMARC resolve (network permitting).

## 2. Production environment variables (Vercel)
- [ ] _Optional:_ set `EMAIL_UNSUBSCRIBE_SECRET` (dedicated HMAC key for unsubscribe links). Falls back to `INTERNAL_PUSH_SECRET`/`CRON_SECRET`, so unsubscribe still works without it — set it only to rotate independently.
- [ ] Confirm `CRON_SECRET` (or `INTERNAL_PUSH_SECRET`) is set so the new `scorecard-weekly` cron is authorized (the other crons already use it).
- [ ] Confirm `RESEND_API_KEY` + `INVITE_FROM_EMAIL` are set and the from-domain matches the verified domain above.

## 3. Pull requests
- [x] PR #144 (scorecard present/PDF/weather-report + weekly-digest unsubscribe) — **merged**, migration 195 applied.
- [ ] PR #145 (one-click unsubscribe for the operational reminders) — review + merge once CI is green. (Say the word and I'll mark it ready + merge.)

## 4. Manual smoke tests (can't run these in the sandbox)
- [ ] **Scorecard → Present**: fullscreen hides chrome; Esc/Exit restores layout.
- [ ] **Scorecard → PDF**: downloads a one-page report with the **tenant logo in the header**.
  - [ ] If the logo is blank, set `logo_url` for the tenant in tenant settings.
- [ ] **Weekly weather report** (`scorecard-weekly` cron): trigger it, confirm the email arrives and the **unsubscribe link** opens the confirm page → opt-out works.
- [ ] **Weekly digests** (incident-trends, chemicals): confirm the unsubscribe link + that opted-out addresses are dropped.
- [ ] **Reminder emails** (training-expiry, overdue-CAPA action, care follow-up): confirm the unsubscribe link is scoped to the `reminders` stream.
- [ ] **Independence check**: opting out of `reminders` must NOT stop the `weekly_digest` emails, and vice-versa.

## 5. Not unsubscribe-able by design (no action — just FYI)
Investigation-SLA escalations and the annual OSHA-300A posting prompt intentionally have **no** unsubscribe — they're low-volume, event-driven, and safety/legally important.

## 6. From the principal test (2026-05-24)
- [ ] **Mobile deep-link placeholders** — `apps/web/public/.well-known/apple-app-site-association`, `apps/web/public/.well-known/assetlinks.json`, and `apps/mobile/eas.json` still contain `REPLACE_WITH_…` values (Apple Team ID, Android release SHA-256, App Store Connect app id). Fill these before the mobile launch / universal-link rollout.
  - [ ] Confirm `ALLOW_DEEPLINK_PLACEHOLDERS=1` is set in the **Vercel** build env (the web `prebuild` runs the strict deep-link check and would otherwise fail the deploy until the placeholders above are real).
- [x] **Test-suite health — RESOLVED by PR #188 (2026-06-05):** the 81 stale failing unit tests (Spectrum-restyle text matchers, hardcoded `features` registry counts) were repaired and the suite went back to green (~3,377 passing). Vitest still does not gate CI (CI runs the repo/wiki guards only).

## 7. AI follow-ups (2026-05-24)
- [ ] **Train the agent on more manuals — admin upload UI.** The RAG ingest pipeline exists (`apps/web/lib/ai/{chunker,embeddings,policyExtract,syncManualToRag}.ts` → `knowledge_documents`/`knowledge_chunks`), but there's no friendly admin page to upload an arbitrary manual/policy and run it. Build that page (global regs vs. per-tenant policy) so you can train the agent without code. _(Deferred — its own focused build.)_
- [ ] **Mobile parity** — see `docs/mobile-parity-plan.md`. Tier 1: mobile AI assistant (reuse `/api/assistant/chat`), field permit/incident/inspection/BBS capture, push notifications.
- **WLS demo seed — DONE:** the WLS Demo tenant has demo overdue CAPAs + expired certs (tagged "Demo —") so the incident-risk predictor + weather-report preview show a rich scenario.

## 8. Scorecard historical import — year-over-year (2026-05-24)
Lets a client backfill up to 20 years of EHS data so the scorecard shows YoY trends. Historical years are stored as annual aggregates in `osha_annual_summaries` (no per-incident fabrication); the current year stays live from `incidents`.
- **Phase 1 — YoY chart — DONE** (merged): TRIR + recordables by year on the scorecard. WLS seeded 2006→2026.
- **Phase 2 — PDF import — IN REVIEW** (PR #159): upload a 300A PDF → Claude structured extraction → admin review/edit → confirm → upsert. Human-in-the-loop required.
- **Phase 3a — CSV/spreadsheet import — IN REVIEW** (PR #160, stacked on #159): upload a SaaS export → column mapping → preview → batch upsert many years.
- [ ] **Phase 3b — Intelex API connector — BLOCKED on credentials.** Build a direct connector that pulls annual EHS metrics from Intelex into `osha_annual_summaries` (same upsert path as PDF/CSV). **Needs from the client before coding a live adapter:**
  - [ ] Intelex **API credentials** (token or OAuth client id/secret).
  - [ ] The client's **Intelex instance/base URL**.
  - [ ] Which **Intelex object/endpoint** holds the annual rollup (or per-incident data we aggregate), + field mapping to the 300A fields.
  - [ ] Where to store the secret (Vercel env / a `tenant_integrations` table) + per-tenant scoping.
  - Plan: scaffold a generic `HistoryConnector` interface + a stubbed Intelex adapter first (plumbing + admin "Connect Intelex" UI), then drop in the live adapter once creds land.

