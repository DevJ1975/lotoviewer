# Injured-Person Case Management — Improvement Plan

_Status: Phase 0 in progress. Last updated: 2026-05-24._

This plan upgrades Soteria FIELD's case management for injured persons to
satisfy three audiences at once:

1. **OSHA** — accurate 1904 recordkeeping (300/300A/301), 1904.39 severe-injury
   reporting, and defensible day-counting.
2. **Insurance carriers / TPAs** — what an adjuster needs to open and run a
   workers'-comp claim: First Report of Injury, wage data, reserves & paid
   amounts, return-to-work documentation, and a clean claim packet.
3. **Confidentiality & the law** — ADA/GINA medical-record confidentiality,
   the HIPAA Security Rule safeguard bar, and per-tenant consent tracking.

…with **AI guidance** woven through as an administrative co-pilot for the case
manager — never as a source of medical advice.

The scope decisions locked for this plan: support **both** carrier-insured and
self-insured/TPA models, and build a **multi-state statutory-form engine** from
the start (not a single hardcoded form).

---

## 1. Where we are today (baseline)

The injured-person workflow already exists and is well-architected. The plan
**extends** it; it does not rebuild it.

| Capability | Where | Notes |
|---|---|---|
| Care case record | `migrations/064_incident_care_cases.sql`, `packages/core/src/incidentCare.ts` | status, physician/clinic/diagnosis, day counters, RTW + modified-duty dates, restrictions[], drug test, case manager, follow-up |
| Per-visit log | `incident_care_visits` (064) | clinic/phone/email/followup/therapy |
| Injured-person PII gating | `migrations/060_incident_people.sql` | `can_view_incident_pii()` + redacted `incident_people_safe` view |
| OSHA recordability | `migrations/065_osha_compliance.sql`, `packages/core/src/incidentClassification.ts` | 1904.7 decision tree, privacy-case handling, AI-suggest fields |
| OSHA 300 / 300A | `osha_300_log_entries`, `osha_annual_summaries` (065) | cached log rows, certification lock, posting tracking |
| OSHA 301 PDF | `apps/web/lib/pdfOsha301.ts` | employee / physician / case blocks |
| Severe-injury 1904.39 | `migrations/197_incident_severe_injury_reports.sql`, `packages/core/src/oshaSevereInjuryReport.ts` | 8h fatality / 24h hospitalization-amputation-eye clock |
| Care UI / API | `app/incidents/[id]/care/page.tsx`, `app/api/incidents/[id]/care/route.ts` | admin / investigator / case-manager gate at the route |
| Follow-up cron | `app/api/cron/incident-care-followup/route.ts` | daily nudge to case manager |
| AI assistant | `app/api/assistant/chat/route.ts`, `lib/ai/{systemPrompt,tools/index}.ts` | RAG over 29 CFR + tenant policy; tool registry; classify AI-suggest |

### Free-text seam already present

`incidents.workers_comp_claim_number` exists as a free-text field — the only
carrier-facing data today. Everything in Phase 2 hangs off replacing this seam
with a structured claim record.

---

## 2. Gap analysis by audience

### 2.1 Confidentiality / legal (HIGHEST priority — Phase 0)

- **RLS does not enforce least privilege on medical data.** `incident_care_cases`
  and `incident_care_visits` have **tenant-wide** RLS (`for all` to any tenant
  member). The admin/investigator/case-manager restriction lives only in the
  API route. A tenant member calling PostgREST directly is not blocked at the
  data layer from reading `diagnosis`. → Gate with a `can_view_care_phi()`
  predicate, mirroring `can_view_incident_pii()`.
- **No access (read) logging on medical data.** Change-audit exists for
  `incidents`; care tables have none, and reads are never logged. HIPAA §164.312(b)
  and good ADA hygiene both want an access trail. → change-audit triggers +
  an append-only `phi_access_log` written by the API layer on view/export.
- **No consent / medical-authorization record.** Disclosing medical info to a
  carrier needs the worker's signed release (HIPAA §164.508 where applicable;
  practical necessity always). → `incident_medical_authorizations`.
- **Medical documents would co-mingle with general evidence.** Work-status notes
  belong in a restricted store, not the investigator-visible `incident-evidence`
  bucket. → `incident_medical_documents` + a restricted `medical-records` bucket.
- **No PHI posture documentation.** `docs/security/POSTURE.md` has no PHI / HIPAA
  / ADA section and no BAA workflow.

> **Legal framing (important, so we neither over- nor under-claim):**
> Employer-held workers'-comp injury records are largely **outside** the HIPAA
> *Privacy* Rule (the employment-records exclusion, plus the §164.512(l) WC
> disclosure permission). What unambiguously **does** bind the employer is
> **ADA 29 CFR 1630.14(c)** — employee medical information must be collected on
> separate forms, kept in **separate medical files**, and treated as
> **confidential** with access on a need-to-know basis — and **GINA** for
> genetic/family-history. Several states add medical-privacy statutes (e.g. CA
> CMIA). Our standard: **build to the HIPAA Security Rule safeguard bar** (access
> control, audit, integrity, transmission security, encryption) so we satisfy
> ADA/GINA/state law by construction and can sign a **BAA** if a tenant's
> occupational-health clinic ever makes us a Business Associate.

### 2.2 OSHA recordkeeping (Phase 1)

- Day counters (`days_away`, `days_restricted`, `days_lost`) are **manual ints**.
  No derivation from `modified_duty_start` / `return_to_work_at`, no 1904.7(b)
  calendar-day counting, **no 180-day cap**, no day-of-injury exclusion.
- The 300-log refresh on care PATCH is documented but should be verified end to
  end (counters → `osha_300_log_entries` → 300A totals → scorecard DART/LTIR).
- Privacy-case status is computed at classification but not surfaced/linked on
  the care case.

### 2.3 Insurance / workers' comp (Phase 2–3 — the largest gap)

What carriers/TPAs/adjusters expect that we don't yet have:

- **First Report of Injury (FROI)** — statutory, state-specific (CA 5020, TX
  DWC-1, NY C-2F, FL DWC-1, …). Today: nothing.
- **Structured claim record** — carrier name, claim #, adjuster contact, claim
  type (medical-only vs lost-time), date reported to carrier, status.
- **Wage / indemnity inputs** — average weekly wage (AWW), comp rate.
- **Financials** — reserves and paid amounts (indemnity / medical / expense),
  total incurred. Drives self-insured cost rollups and the experience mod (EMR).
- **Return-to-work program artifacts** — transitional/light-duty **job offer**,
  physician **work-status notes**, modified-duty timeline. Carriers reward RTW
  because it cuts indemnity; this is where employers save the most money.
- **Panel-of-physicians / designated provider** direction (state-specific).
- **Claim packet** — a single bundle for the adjuster: FROI + 301 + witness
  statements + photos + restriction summary + signed authorization.
- **Reporting-deadline tracking** — most states require employer→carrier report
  within a few days; missing it is a penalty. Mirror the severe-injury SLA cron.

### 2.4 AI guidance (Phase 4)

- No assistant tools touch care/claims. No new-injury guided checklist. The
  system prompt has no PHI minimum-necessary rule and no explicit "administrative
  guidance, not medical advice" boundary for case management.

---

## 3. Target data model (additions)

All new tables: `tenant_id NOT NULL`, RLS gated by `can_view_care_phi()`,
`touch_updated_at` trigger, `log_audit('id')` change-audit, idempotent DDL.

```
incident_care_cases            (exists — 064)
incident_care_visits           (exists — 064)

-- Phase 0 (confidentiality)
can_view_care_phi(incident_id) -- security-definer predicate
phi_access_log                 -- append-only view/export trail
incident_medical_authorizations-- signed consent / release
incident_medical_documents     -- restricted medical-records bucket metadata

-- Phase 2 (claim)
incident_wc_claims             -- carrier, adjuster, type, status, AWW, reported-to-carrier
incident_wc_claim_financials   -- reserves + paid by bucket (indemnity/medical/expense), point-in-time
wc_carriers                    -- per-tenant carrier/TPA directory + adjuster contacts
statutory_form_templates       -- multi-state form engine: form code → field map + renderer key
statutory_form_filings         -- a rendered/filed instance of a form for an incident

-- Phase 3 (RTW)
incident_rtw_offers            -- transitional/light-duty job offers + acceptance
incident_work_status_notes     -- physician work-status over time (links a medical_document)
```

The **multi-state form engine** (`statutory_form_templates` +
`statutory_form_filings`) is a data-driven field map per form code, rendered by
a registry of PDF renderers keyed like the existing `pdfOsha301` / `pdfPermit`
modules — so adding a state form is "add a template row + a renderer", not a
schema change.

---

## 4. Phased delivery

Each phase is its own small PR: one migration (number ≥ 201), feature-flagged,
`tsc --noEmit` clean, vitest + an RLS forge test, a wiki page, and a WLS-demo
seed where it helps the walkthrough.

### Phase 0 — Confidentiality hardening _(in progress)_

- `migrations/201_care_phi_confidentiality.sql`:
  - `can_view_care_phi(incident_id)` (superadmin / owner-admin / assigned
    investigator / designated case manager).
  - Tighten `incident_care_cases` + `incident_care_visits` RLS to use it.
  - Change-audit triggers on both care tables (`log_audit('id')`).
  - `phi_access_log` (append-only: revoke update/delete + immutable trigger).
  - `incident_medical_authorizations` + `incident_medical_documents` (RLS-gated).
- `app/api/incidents/[id]/care/route.ts`: write a `phi_access_log` `view` row on
  authorized GET (best-effort; never fails the read).
- `packages/core/src/incidentCare.ts`: types + validators for authorizations and
  medical documents.
- `docs/security/POSTURE.md`: new §12 — PHI / HIPAA Security Rule mapping, ADA
  confidentiality, BAA workflow.
- Tests: extend `__tests__/lib/incidentCare.test.ts`.

**Exit criteria:** a plain member cannot read `incident_care_cases` via direct
PostgREST; every authorized read lands a `phi_access_log` row; medical docs have
a segregated home.

### Phase 1 — OSHA day-counter engine

- `packages/core/src/oshaDayCounter.ts`: pure functions — calendar-day count
  between dates, day-of-injury exclusion, 180-day cap, away-vs-restricted split
  driven by case-status transitions. Manual override with a stored reason.
- Wire derived counters through the care PATCH → `osha_300_log_entries` refresh;
  add a regression test that DART/LTIR move correctly.

### Phase 2 — Workers'-comp claim management

- `incident_wc_claims`, `incident_wc_claim_financials`, `wc_carriers`.
- Claim tab on the incident; replace the free-text `workers_comp_claim_number`
  seam (keep it as a mirror for back-compat during migration).
- **Multi-state form engine**: `statutory_form_templates` + `statutory_form_filings`
  + a renderer registry. Seed federal generic + the first batch of state FROIs
  (CA 5020, TX DWC-1, NY C-2F, FL DWC-1 to start).
- Claim-packet bundle export (reuse `apps/web/lib/pdfBundle.ts`).
- `app/api/cron/wc-report-deadlines`: carrier-reporting SLA (mirror
  `incident-investigation-sla`).

### Phase 3 — Return-to-work program

- `incident_rtw_offers` + `incident_work_status_notes`.
- RTW-plan PDF (already flagged as a TODO in `care/page.tsx`).
- Cost-of-claim + lost-day dashboards on the incidents scorecard; EMR inputs.

### Phase 4 — AI guidance (human-in-the-loop)

- Assistant tools (`lib/ai/tools/index.ts`): `injury_case_status`,
  `wc_reporting_deadlines`, and **drafters** — RTW-checklist and FROI-narrative —
  that produce drafts for human review (mirror classify AI-suggest / 300A-extract).
- New-injury guided checklist: 8h/24h severe-injury clock → recordability prompt
  → drug-test window → carrier-report deadline → RTW planning.
- `lib/ai/systemPrompt.ts`: add a PHI minimum-necessary rule (never surface
  diagnosis to unauthorized roles via the assistant) and an explicit
  "administrative/compliance guidance, **not** medical advice" boundary.

---

## 5. AI safety posture for this domain

- The assistant **drafts and references**; it never diagnoses, never sets
  restrictions, never decides recordability or compensability. Those are human
  decisions, surfaced as draft + review.
- Tools that read PHI (`injury_case_status`) enforce `can_view_care_phi()` server
  side and refuse for unauthorized roles — same pattern as `send_alert`'s role
  refusal.
- Aggregates (scorecard, cost trend) are de-identified — counts and rates, no
  names or diagnoses.

---

## 6. Open decisions / inputs needed later

- State FROI batch order beyond the first four (driven by where tenants operate).
- Whether financials are entered manually or pulled from a carrier/TPA feed
  (parallels the Intelex connector pattern in `todos.md` §8 — scaffold an
  interface, stub an adapter, drop in live creds later).
- BAA template + which tenants need one (legal/business, not engineering).
