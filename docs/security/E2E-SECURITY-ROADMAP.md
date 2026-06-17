# SoteriaField — End-to-End Security Roadmap

_Owner: platform team. Status: proposed. Driver: HIPAA Security Rule bar (sensitive
PII + employee medical detail). Companion to `docs/security/POSTURE.md`._

## How to read this document

`docs/security/POSTURE.md` describes the **current state** for due-diligence reviewers.
**This document is the forward-looking program**: what is already strong, what is
scheduled, and what remains a gap — sequenced into phases and mapped to the HIPAA
Security Rule. Nothing here is implemented by the act of writing it; each item is a
recommendation with an owner-assignable scope.

We build to the **HIPAA Security Rule** safeguard bar. Most of the employee medical
detail SoteriaField holds (workers'-comp / occupational injury) is legally governed by
**ADA 29 CFR 1630.14(c)** and **GINA** rather than the HIPAA Privacy Rule (see
POSTURE.md §12), but adopting the HIPAA Security Rule as the technical bar satisfies
those obligations by construction and lets us sign a BAA if a tenant's clinic ever makes
us a Business Associate.

---

## 1. What is already in place (do not re-litigate)

These controls were verified in code and are considered **Done**. The roadmap builds on
them rather than repeating them.

| Domain | Control | Evidence |
|---|---|---|
| Tenant isolation | 4 layers: Bearer JWT → tenant gate (`x-active-tenant` checked vs `tenant_memberships`) → Postgres RLS (`active_tenant_id()`) → per-row `eq('tenant_id', …)` on service-role calls | `apps/web/lib/auth/tenantGate.ts`, `apps/web/lib/supabaseAdmin.ts`, `migrations/*` |
| PHI confidentiality | `can_view_care_phi()` RLS predicate; append-only **immutable** `phi_access_log`; segregated `medical-records` bucket; authorization-for-disclosure gating | `migrations/201_care_phi_confidentiality.sql`, `app/api/incidents/[id]/care/route.ts`, `packages/core/src/incidentCare.ts` |
| Privileged access | Dual-control superadmin (`profiles.is_superadmin` **and** `SUPERADMIN_EMAILS` env) | `apps/web/lib/auth/superadmin.ts` |
| File uploads | Size cap + MIME allowlist + **magic-byte** verification | `apps/web/lib/security/magicBytes.ts` |
| Error hygiene | DB errors mapped to public-safe codes; full detail only to Sentry | `apps/web/lib/security/sanitizeError.ts` |
| Telemetry minimization | Sentry `beforeSend`/`beforeBreadcrumb` field scrubber; **session replay OFF by default** | `apps/web/instrumentation-client.ts` |
| CSRF | Origin/Host cross-check on state-changing `/api/*` | `apps/web/proxy.ts` |
| Anonymous intake | Turnstile (fail-closed) + per-IP throttle (fail-closed) + 256-bit tokens | `apps/web/lib/anonReport/*` |
| Webhooks / secrets | HMAC signing, constant-time `safeEqual`, segmented env (no client-side secret reads) | POSTURE.md §4, §7 |
| AI abuse | Per-user/tenant rate limits + per-tenant budget kill-switch | `apps/web/lib/ai/rateLimit.ts` |

**Bottom line:** the foundation is solid. The gaps below are about *defense-in-depth*,
*identity assurance*, *operational/compliance maturity*, and *finishing scheduled work* —
not repairing a broken core.

---

## 2. Roadmap at a glance

| Phase | Theme | Effort | Risk | Headline items |
|---|---|---|---|---|
| **0** | Quick wins & critical closeouts | ~1–2 wks | Low | Security headers + CSP, `server-only` guard, Supabase advisors, CI scanning, auth toggles, close §10 Criticals |
| **1** | Identity & session hardening | ~2–4 wks | Med | MFA, automatic logoff, distributed rate limiting, SCIM offboarding, webhook SSRF |
| **2** | Data protection & PHI | ~3–6 wks | Med | Column-level encryption, retention/disposal, backup+DR test, AI/PHI DPIA & ZDR |
| **3** | Monitoring, audit & supply chain | Ongoing | Low | SIEM + 6-yr retention, anomaly alerting, SAST/DAST/SBOM, httpOnly-cookie sessions |
| **4** | Governance & assurance | Ongoing | Low | Risk analysis, policies, IR/breach runbook, BAA register, pen test, VDP |

---

## 3. Phase 0 — Immediate quick wins & critical closeouts

Low-risk, high-leverage. Most are configuration or finishing already-drafted migrations.

### 3.1 Security response headers + Content-Security-Policy *(Gap — High)*
Today only `.well-known` content-type headers are set (`apps/web/next.config.ts`); there
is no CSP, HSTS, framing, or referrer policy. Add via `apps/web/proxy.ts` (already runs at
the edge) or `next.config.ts` `headers()`:
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` — **ship `Content-Security-Policy-Report-Only` first**, tune
  against real traffic (Supabase, Sentry, Turnstile, Anthropic streaming origins), then enforce.
- `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy` (deny camera/mic/geolocation unless a feature needs them)
- `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-site`

**Why first:** a strong CSP is the primary XSS mitigation, and XSS is the most direct path
to PHI session theft given JWTs live in `localStorage`.

### 3.2 `server-only` guard on the admin client *(Gap — Medium)*
Add `import 'server-only'` at the top of `apps/web/lib/supabaseAdmin.ts` so any accidental
import into a client component fails the build instead of relying on bundler convention to
keep `SUPABASE_SERVICE_ROLE_KEY` out of the browser.

### 3.3 Run Supabase Security Advisors *(Verification — recurring)*
Run the `get_advisors` security + performance checks against the project and triage. It
flags RLS-disabled tables, exposed views, and mutable function `search_path` directly from
the live schema. Make it a standing pre-release check (and wire it into CI where feasible).

### 3.4 Supabase Auth hardening toggles *(Gap — High)*
- Enable **leaked-password protection** (HIBP) and a password-strength policy.
- Enable **MFA (TOTP) enrollment** now (enforcement lands in Phase 1).

### 3.5 Supply-chain scanning in CI *(Gap — High)*
In `.github/workflows/`:
- GitHub **secret scanning + push protection**.
- **Dependabot** (or Renovate) + an `npm audit --audit-level=high` gate.
- **CodeQL** SAST on PRs.
- Pin third-party GitHub Actions to commit SHAs.

### 3.6 Sentry replay guardrail *(Gap — documentation/decision)*
Replay is off by default — keep it off for PHI-bearing surfaces. Document that if it is
ever enabled, `maskAllText: true` + `blockAllMedia: true` are mandatory and care/medical
routes are explicitly blocked.

### 3.7 Close POSTURE.md §10 Critical items *(Scheduled — Critical)*
Migrations are already drafted; sequence them now:
- **Tenant API-key & webhook-secret envelope encryption** (`pgp_sym_encrypt` → `tenant_secrets`), draft `migrations/114_*`.
- **`loto-photos` storage SELECT** restricted to tenant scope, draft `migrations/115_*`.

### 3.8 Documentation fix *(Gap — trivial)*
POSTURE.md §9 references `apps/web/middleware.ts`; the live file is `apps/web/proxy.ts`
(Next.js 16 renamed the convention). Correct the reference.

---

## 4. Phase 1 — Identity & session hardening

### 4.1 MFA enforcement *(Gap — High; HIPAA §164.312(d))*
Require MFA for **superadmin/admin and any PHI-access role** (assigned investigator, case
manager), with a path to org-wide enforcement. Couple with step-up re-auth for sensitive
superadmin actions.

### 4.2 Automatic logoff / idle timeout *(Gap — Medium; HIPAA §164.312(a)(2)(iii))*
Enforce an idle session timeout and absolute session lifetime in addition to Supabase's
short-lived JWTs.

### 4.3 SCIM/SSO offboarding & access reviews *(Gap — Medium; HIPAA §164.308(a)(3)/(4))*
SSO/SCIM exists (migration 160). Add a verified **deprovisioning-on-exit** workflow and
formalize **periodic access reviews** (POSTURE.md already runs `is_admin` quarterly —
extend to tenant roles and PHI-access grants, with evidence).

### 4.4 Distributed rate limiting *(Gap — Medium)*
Replace in-process `apps/web/lib/rateLimit/memory.ts` with Vercel KV / Upstash Redis.
In-memory counters don't hold across serverless instances, which matters most for
auth brute-force and anonymous-intake abuse.

### 4.5 Webhook SSRF protection *(Scheduled — High; POSTURE.md §10)*
Validate tenant-supplied webhook URLs against private-IP ranges + a scheme allowlist in
`fire_webhooks()`. Migration `116_*` is drafted.

---

## 5. Phase 2 — Data protection & PHI controls

### 5.1 Column-level encryption for free-text medical detail *(Scheduled — Medium)*
Encrypt the free-text `diagnosis` field beyond at-rest disk encryption (see
`docs/injury-case-management-plan.md`), reusing the envelope-encryption path from §3.7.

### 5.2 Data retention & disposal *(Gap — Medium; HIPAA minimum-necessary)*
Define a written retention schedule per data class and implement automated purge/disposal
for PHI past retention. De-identify where retention is for analytics only.

### 5.3 Backup encryption + tested DR restore *(Gap — High; HIPAA §164.308(a)(7))*
Confirm encrypted backups and run a **documented restore drill**; record RPO/RTO. A
contingency plan with an untested restore is a finding waiting to happen.

### 5.4 De-identification standard *(Gap — Low)*
Codify that scorecards / cost-trend aggregates are de-identified counts/rates, and define
the small-cell suppression threshold to prevent re-identification.

### 5.5 AI / PHI data-flow assurance *(Gap — High)*
- Execute an **Anthropic BAA + Zero-Data-Retention** for any workload that can include PHI;
  confirm tenant data is not used for training.
- Document the PHI data-flow (a lightweight **DPIA**) and the assistant PHI-minimization rule.
- Add **prompt-injection defenses** on RAG/assistant paths (untrusted document content must
  not be able to exfiltrate cross-tenant data or escalate tool use).
- Complete per-tenant API-key envelope encryption (from §3.7) so tenant keys aren't plaintext jsonb.

---

## 6. Phase 3 — Monitoring, audit & supply-chain assurance

### 6.1 Centralized, tamper-evident audit logging *(Gap — High; HIPAA §164.312(b))*
Ship `audit_log` + `phi_access_log` to a SIEM/log store with **6-year retention** and
integrity protection. The DB triggers are the source of truth; this is durable export +
correlation.

### 6.2 Anomaly alerting *(Gap — Medium)*
Alert on failed-login spikes, cross-tenant 403 spikes (forged `x-active-tenant`), superadmin
actions, and abnormal PHI-export volume.

### 6.3 SAST / DAST / SBOM / branch protection *(Gap — Medium)*
Add DAST against staging, generate an SBOM per release, and enforce branch protection +
required reviews on `main`.

### 6.4 Session model hardening *(Gap — Medium)*
Once CSP is enforced (§3.1), evaluate migrating sessions from `localStorage` JWTs to
**httpOnly cookies** via `@supabase/ssr`, reducing XSS token-theft exposure. Sequence this
after CSP so the change is additive, not a regression risk.

---

## 7. Phase 4 — Governance & continuous assurance

- **Risk analysis** (HIPAA §164.308(a)(1)) — formal, documented, annual, with a tracked risk register.
- **Policies & procedures** — access control, incident response, contingency, sanction policy.
- **Workforce security** — security-awareness training, background checks, sanction policy.
- **Incident response & breach-notification runbook** (§164.308(a)(6) + 60-day Breach Notification Rule) with a tabletop exercise.
- **Subprocessor / BAA register** — Supabase, Anthropic, Vercel, Sentry, Resend, Cloudflare, Voyage; flag which touch PHI and obtain BAAs/DPAs.
- **Annual third-party penetration test**; remediate findings on a tracked SLA.
- **Vulnerability disclosure program** — add a top-level `SECURITY.md` with a reporting contact and safe-harbor.
- **Key rotation cadence** — documented schedule for service-role, cron, VAPID, and tenant keys.

---

## 8. Appendix — HIPAA Security Rule control mapping

Status legend: **Done** (verified in code) · **Scheduled** (drafted/tracked) · **Gap** (recommended here).

### Technical safeguards (§164.312)
| § | Safeguard | Control | Status | Reference |
|---|---|---|---|---|
| (a)(1) | Access control | RLS + tenant gate + `can_view_care_phi()` | Done | `tenantGate.ts`, `migrations/201` |
| (a)(2)(iii) | Automatic logoff | Idle + absolute session timeout | Gap | §4.2 |
| (a)(2)(iv) | Encryption at rest | Supabase disk encryption; column-level for `diagnosis`; tenant-secret envelope | Scheduled | §3.7, §5.1 |
| (b) | Audit controls | `audit_log` triggers + immutable `phi_access_log`; SIEM export + 6-yr retention | Done / Gap | §6.1 |
| (c) | Integrity | `phi_access_log_immutable()` trigger; magic-byte upload check | Done | POSTURE.md §5, §12 |
| (d) | Person/entity auth | Supabase JWT auth; **MFA** | Done / Gap | §4.1 |
| (e)(1) | Transmission security | TLS everywhere; CSP/HSTS | Done / Gap | §3.1 |

### Administrative safeguards (§164.308)
| § | Safeguard | Status | Reference |
|---|---|---|---|
| (a)(1) | Security management / risk analysis | Gap | §7 |
| (a)(3)/(4) | Workforce access mgmt & authorization | Done / Gap | §4.3 |
| (a)(5) | Security awareness & training | Gap | §7 |
| (a)(6) | Incident procedures / breach notification | Gap | §7 |
| (a)(7) | Contingency plan (backup + tested restore) | Gap | §5.3 |
| (b)(1) | Business Associate Agreements | Gap | §5.5, §7 |

### Physical safeguards (§164.310)
Facility/device controls are inherited from the cloud providers (Supabase, Vercel) under
their SOC 2 / HIPAA programs; covered contractually via the BAA register (§7). No
self-hosted infrastructure in scope.

---

## 9. Sequencing principle

Land Phase 0 first — it is cheap, reduces the largest exposures (XSS→PHI theft, supply
chain, leaked credentials) and closes the customer-visible Criticals already drafted.
Phases 1–2 raise identity and data-protection assurance to the HIPAA bar. Phases 3–4 make
the posture *continuous and auditable* rather than point-in-time. Each phase is independently
shippable and independently valuable.
