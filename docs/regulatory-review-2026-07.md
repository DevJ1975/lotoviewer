# Regulatory review — July 2026

A CSP-lens sweep of federal OSHA and Cal/OSHA: what changed, what is coming,
and what each item means for Soteria FIELD's feature set.

**Review date:** 2026-07-29 · **Next review due:** 2027-01 (or when the
LOTO NPRM lands — see [F1](#f1))

---

## ⚠️ Read this before citing anything below

The session that produced this review **could not fetch a single primary
source**. `federalregister.gov`, `osha.gov`, `reginfo.gov`, and `dir.ca.gov`
all returned **403 at the egress proxy on CONNECT**. Web *search* worked; web
*fetch* did not.

Everything here is therefore derived from **search-engine indexing of primary
sources plus law-firm and trade secondary reporting** — not from reading the
documents. Confidence is marked per item:

| Mark | Meaning |
|---|---|
| ✅ | Re-verified against a second independent search during the review |
| ⚠️ | Single research pass, secondary sources only |
| ❌ | Could not verify at all — listed so it isn't mistaken for absence |

**This is good enough to prioritize engineering work. It is not
citation-grade.** Before any of it reaches a customer-facing compliance
surface, a human must open the cited URLs. Highest-value confirmations:

1. <https://www.osha.gov/deregulatory-rulemaking> — status table for the whole 2025–26 package
2. <https://www.reginfo.gov/public/do/eAgendaMain> — Unified Agenda, agency 1218
3. <https://www.dir.ca.gov/oshsb/proposedregulations.html> — Cal/OSHA Standards Board
4. ASSP's free technical brief for Z244.1-2024

### The design rule this caveat produced

**No regulatory fact from this review is hardcoded in TypeScript as product
ground truth.** Regulatory content reaches users as *data fetched at runtime
from primary sources by the production app* — which can reach the Federal
Register API; the `osha-reg-watch` cron already does. The only regulatory
facts committed to code are the two the product must act on deterministically
(reporting windows, cited standard edition), and both carry their source in a
comment.

---

## F. Federal OSHA

### F1. Lockout/Tagout modernization — RIN 1218-AD00 ✅ {#f1}

**The most consequential item in this review for this product.**

Advanced from the 2019 RFI to **Proposed Rule stage, with an NPRM projected
November 2026** — first movement in seven years. It targets the two RFI
questions directly: **control-circuit-type (safety-rated) devices** as an
alternative to physical isolation, and **robotics**. OSHA's stated rationale
is the conflict between 1910.147's prohibition on push buttons and selector
switches for energy isolation and modern computer-based safety controls, plus
international harmonization.

**Product impact — Tier 4, deliberately deferred.** The current model is
procedure-per-machine with no concept of a *task*, a *risk assessment*, an
*alternative method*, or a device's *safety rating*. That is the shape the
NPRM points at. Building it against a projection would be guessing; build it
against the published text.

### F2. HazCom (GHS Rev. 7) — 29 CFR 1910.1200 ✅

Final rule May 2024; compliance dates **extended four months** by a final rule
effective 15 Jan 2026.

| Who | Deadline | Status |
|---|---|---|
| Manufacturers/importers — substances | 19 May 2026 | passed |
| **Employers — substances** | **20 Nov 2026** | **~4 months out** |
| Manufacturers/importers — mixtures | 19 Nov 2027 | pending |
| Employers — mixtures | 19 May 2028 | pending |

By 20 Nov 2026 an employer needs an updated **written program**, updated
**workplace labels**, and **retrained employees** on the new label elements
and SDS format.

**Product impact — Tier 3a, sequenced first.** Nearest hard deadline in the
review, and it lands on modules that already exist (chemicals/SDS + the
training & competency matrix). See [Roadmap](#roadmap).

### F3. Heat ⚠️/✅

- **Heat NEP, CPL 03-00-024** ✅ — prior NEP expired 8 Apr 2026; **revised
  directive issued 10 Apr 2026, running five years**. 55 target industries,
  indoor *and* outdoor. Numerical inspection goal dropped; two new appendices,
  one for **evaluating employer heat programs** and one for **citation
  guidance**. Programmed inspections whenever NWS issues a heat advisory.
- **Heat standard, RIN 1218-AD39** ⚠️ — **SNPRM projected Dec 2026**, final
  projected Oct 2027. Another full comment cycle means no federal standard
  before roughly 2028; enforcement runs on the NEP and the General Duty Clause.

### F4. Recordkeeping and inspection targeting ⚠️

- **1904.41** — since 1 Jan 2024, establishments with 100+ employees in
  Appendix B industries submit **case-level 300 and 301 data**, not just 300A,
  by **2 March** annually.
- **ITA Non-Responder Enforcement Program** (OSHA memo, 23 Mar 2026) — a
  weekly OIS scan cross-matches open inspections against establishments that
  failed to submit CY2025 300A; Area Offices cite 1904.41 on top of whatever
  else they find.
- **Site-Specific Targeting, CPL 02-01-067** (eff. 20 May 2025) — drives
  programmed non-construction inspections off submitted 300A rates, with
  high-rate, upward-trending, low-rate, and **non-responder** lists.

**Product impact — already covered.** The platform has `osha-ita-auto-submit`
and `osha-300a-posting-prompt` crons and an ITA submission path. Worth a
follow-up check that the auto-submit covers case-level 300/301 for
Appendix B establishments, not only 300A.

### F5. Other federal items ⚠️

- **PPE fit in construction, 1926.95(c)** — effective 13 Jan 2025; PPE must be
  "selected to ensure that it properly fits each affected employee."
- **LOTO Letter of Interpretation, 24 Nov 2025** — non-lockout devices are
  permissible **while awaiting parts** if nobody is exposed; **before
  servicing resumes**, authorized employees must verify isolation and apply a
  compliant LOTO device.
- **Civil penalties** — **no 2026 adjustment** (a shutdown disrupted the
  statutory review window). 2025 amounts stand: **$16,550** serious/OTS,
  **$165,514** willful/repeated. Counterintuitive: most compliance calendars
  assume an annual January increase.
- **2025–26 deregulatory package** — 25 NPRMs + 1 final rule (1 Jul 2025)
  covering respirator medical evaluation for FFRs/PAPRs, 16 substance-specific
  standards, a General Duty Clause limitation, construction illumination,
  safety color code, and (Apr 2026) removal of the 2036 fixed-ladder retrofit
  deadline. **Almost none of it is final**; hearings began 19 Aug 2026. Only
  the ACCSH consultation removal and two marine-terminal revocations
  completed. **Do not de-scope any feature on the strength of these.**
- **Agenda contraction** — Infectious Diseases **removed**; Workplace Violence
  in Healthcare (RIN **1218-AD08**, not AD24) and Powered Industrial Trucks
  **demoted to Long-Term Action**; the MSD column on the 300 Log **withdrawn**.

### F6. Could not verify ❌

PSM (1910.119) rulemaking stage/RIN/dates · a reported 2025 PSM National
Emphasis Program · Silica NEP renewal (last confirmed directive is
CPL 03-00-023 from Feb 2020) · Tree Care projected NPRM date · **the full
holdings of the seven 10 Dec 2025 Letters of Interpretation** — two of which
bear directly on this product:

- **#4 — Powered Industrial Truck training by live-stream.** Would change what
  the training matrix can accept as a valid delivery method.
- **#5 — software-generated equivalent Forms 300/300A.** Goes to whether this
  platform's generated forms satisfy 1904.29 on their own. **Read this one.**

---

## C. Cal/OSHA

### C1. Workplace Violence Prevention — proposed §3343 ✅

Third discussion draft **24 Apr 2026**; comments closed **1 Jun 2026**. The
Board is **statutorily required to adopt by 31 Dec 2026**; the approval vote is
expected **late summer 2026** with **implementation 1 Jan 2027**.

This layers a Title 8 standard on top of duties **already in force since
1 Jul 2024** under SB 553 / Labor Code §6401.9: a written plan, a **violent
incident log (5-year retention)**, hazard identification and investigation
records (5 years), training records (1 year), and annual training.

**Product impact — Tier 3b.** No representation today. California tenants are
arguably non-compliant right now, two years into the statute.

### C2. Indoor heat — §3396 ✅

Effective **23 Jul 2024**, actively enforced in 2026.

| Trigger | Duties |
|---|---|
| **82°F** | Water, cool-down areas, acclimatization, emergency response, training, **written plan** |
| **87°F** | Adds assessment + engineering/administrative/PPE controls, and **temperature/heat-index measurement records retained 12 months** |

Cool-down areas must be kept **below 82°F**. The 87°F duties drop to 82°F
where employees wear heat-restricting clothing or work in high radiant heat.

**Product impact — Tier 3c.** The measurement log is the piece with no
existing analogue anywhere in the platform.

### C3. Where §3314 diverges from 1910.147 ⚠️

Directly relevant to the LOTO module and its audit agents:

- Scope names **cleaning and setting-up** as triggers; federal says "servicing
  and maintenance"
- **Blockout** is a distinct construct — moveable parts mechanically blocked
- **Accident prevention signs or tags must be placed on the controls of the
  power source**, conforming to §3340/§3341 — an affirmative duty with no
  federal counterpart
- Machine-specific procedures; generic/boilerplate expressly disallowed
- **Interlocks and PLC "softlock" are not acceptable as lockout**
- §2320.4 requires the disconnecting means **locked open**

### C4. Severe-injury reporting ⚠️ — and the defect it exposed

California requires reporting within **8 hours for all four triggers** —
fatality, in-patient hospitalization, amputation, loss of an eye — versus the
federal 8/24 split. The clock starts when the employer "knows, **or with
diligent inquiry would have known**" (Lab. Code §6409.1(b), 8 CCR §342): a
constructive-knowledge standard, not actual knowledge.

**This shipped wrong.** `reportingWindowHours()` returned 24 hours for three
of the four triggers regardless of jurisdiction, so a California tenant's
countdown, status badge, and escalation were **16 hours too generous**.
Fixed — see [Delivered](#delivered).

### C5. Other California items ⚠️

- **Lead, §5198 / §1532.1 / §5155** — effective 1 Jan 2025: PEL **50 → 10
  µg/m³**, action level **30 → 2 µg/m³**. Phase 2 effective **1 Jan 2026**:
  medical removal at BLL ≥20 µg/dL, clean change rooms and end-of-shift
  showers extended below 50 µg/m³.
- **Silica, §5204** — permanent standard operative 5 Feb 2025. Written
  exposure control plan, annual monitoring by a qualified person. **Trap:**
  high-exposure trigger tasks require compliance **even below the action
  level**. **Petition 609 granted** — the Board directed Cal/OSHA to prepare a
  finding of emergency toward an outright **ban on artificial stone >1%
  crystalline silica**.
- **Confined spaces in construction, §§1951–1956** — effective 1 Jan 2026, with
  new definitions of **"lockout" and "tagout"** that a commenter flagged as
  conflicting with §3314's written-procedure requirement. Worth watching: the
  platform's confined-space module is built on 1910.146.
- **Walkaround rule, §331.8** — 15-day modification comment closed 16 Jul 2026;
  a Board vote is plausibly imminent. An employee-authorized representative may
  be a **third party**.
- **COVID-19 §3205** — non-emergency regs expired 3 Feb 2025; §3205(j)
  recordkeeping carried to 3 Feb 2026 and has now lapsed. Records already
  created retain **2 years**.
- **Penalties** — 2025: general/regulatory $16,285, **serious $25,000**
  (exceeds federal), willful/repeat $162,851. **2026 amounts unverified.** ❌
- **Enforcement capacity** — State Auditor Report 2024-115 (17 Jul 2025):
  **32% vacancy rate**, **81% of industrial hygienist posts unfilled**, 82% of
  complaints handled by letter. Programmed-inspection probability is down;
  post-audit pressure points toward stricter abatement verification.
- **No §3314 / §2320.4 / §3203 / §5110 rulemaking found** — absence of
  evidence, not a confirmed negative: the Board's rulemaking index could not be
  loaded. ❌

---

## S. Consensus standards

### S1. ANSI/ASSP Z244.1-2024 ✅ — the audit agents were citing a superseded edition

**A new edition exists and supersedes Z244.1-2016 (R2020).** It is a
substantive revision, not a reaffirmation:

- **Alternative methods elevated to a co-equal choice** with lockout/tagout,
  rather than a fallback of last resort
- New **Section 5, "Hazardous Energy Control Methods"**; updated control
  flowchart
- **Cybersecurity** addressed
- New definitions: equipment, feasible, isolation (and energy dissipation),
  processes, shall, should
- Section 9 gives the methodology for assessing tasks and risks so an
  alternative method is equivalent to lockout

**The trap, and why it is now written into the prompts:** OSHA does **not**
recognize Z244.1 alternative methods as a 1910.147 compliance path, and
Cal/OSHA §3314 expressly rejects interlocks and PLC softlock as lockout. A
procedure can conform to the consensus standard and still be citable.
Conformance ≠ compliance. Fixed — see [Delivered](#delivered).

### S2. Robotics and machine safety ⚠️

- **ISO 10218-1/-2:2025** — in force 1 Apr 2025. **ISO/TS 15066 absorbed**
  (superseded in practice but *not formally withdrawn* — don't call it
  withdrawn in a compliance file). New **Class I / Class II** robot
  classification. Teach mode, reduced speed (250 mm/s), 3-position enabling
  devices, and **restart authorization as a distinct tracked step**.
- **ANSI/A3 R15.06-2025** — Parts 1–2 adopt ISO 10218; **Part 3 is new,
  US-developed, and covers *user* requirements**. That is the part a LOTO
  program lives in.
- **ANSI/A3 R15.08-3-2026** (mobile robots, user requirements) — the newest
  item in this review and the one most likely missing from any existing
  program.
- **NFPA 70E-2027** — **already issued** (Standards Council 16 Apr 2026,
  effective 6 May 2026); there is no 2026 edition. The ESWC process at **120.6
  is 8 discrete steps**, of which LOTO application is step 6 and the
  instrument-based absence-of-voltage test (tester verified **before and
  after**) is step 7. A data model with one `verified zero energy` boolean
  collapses eight verifiable acts into one and loses the tester-verification
  chain. A reported split of the LOTO audit into **Program** and **Procedure**
  audits at 110.3(L)(3)/(L)(4). A new two-person requirement for energized work
  is **contested between sources — do not rely on either version.** ❌
- **Others** — ANSI B11.0-2023, B11.19-2019(R2024), B11.26-2024;
  ISO 13849-1:2023 (**EN ISO 13849-1:2015 loses harmonised status 15 May
  2027**); IEC 62061:2021 +AMD1:2024 +AMD2:2026; ISO 14119:2024; ISO 12100
  revision contested at a 3rd DIS; ISO/DIS 14118 ed. 2 in progress.

---

## Delivered in this pass {#delivered}

### 1. Jurisdiction-aware severe-injury reporting ([C4](#c-calosha))

`reportingWindowHours()` hardcoded the federal 8/24 split. California
requires 8 hours for all four triggers, so a California tenant was shown 16
hours of headroom it did not have on hospitalization, amputation, and loss of
an eye.

- `reportingWindowHours` / `reportingDeadlineMs` / `evaluateSevereInjuryReport`
  now take a **required** `jurisdiction` — required, not defaulted, so a call
  site that forgets it fails to compile rather than silently reporting federal
- Jurisdiction is resolved **server-side** from the incident's facility (then
  the tenant's primary facility, then any registered establishment) and
  **frozen onto the row** (migration 252), so re-pointing a facility later
  never moves a deadline someone was already held to
- Unresolvable states fall back to federal — never the shorter window, so a
  miss can't invent time a site lacks
- California's constructive-knowledge basis is surfaced in the form label
- Existing rows backfill to `federal`: they were tracked under the federal
  window, and recomputing history would retroactively mark past filings late

### 2. Z244.1-2024 in the LOTO agents ([S1](#s1-ansiassp-z2441-2024--the-audit-agents-were-citing-a-superseded-edition))

`apps/web/lib/loto/consensusStandards.ts` is now the single place the cited
edition lives. Every agent prompt names **ANSI/ASSP Z244.1-2024**, and the EHS
gate and the Regulator both carry an explicit conformance-vs-compliance rule:
when the consensus standard and the regulation disagree, **the regulation
decides pass/fail**.

### 3. Regulatory Watch → jurisdiction-aware, plus a "Coming Up" box

The feed was federal-only by construction — the cron queries the Federal
Register filtered to the OSHA agency, and Cal/OSHA rulemaking is not published
there. Migration 232's own comment named the assumption: *"federal OSHA
regulations are identical for every tenant."*

- **Migration 253** adds `jurisdiction` (`federal` | `CA`) to
  `osha_regulation_updates`. The table stays global — the *content* really is
  the same for everyone; what differs is whether it applies — so filtering is a
  read-time concern, not a reason to duplicate rows per tenant.
- **The monthly cron now runs two independent passes.** Federal keeps the
  Federal Register API. Cal/OSHA fetches Standards Board rulemaking pages from
  `dir.ca.gov`, strips them to text, and reads them with a **stricter prompt** —
  the source is scraped prose with no schema, so the model is forbidden from
  inferring any date the page does not state. Either source can be down without
  taking the other with it; only a total outage is an error.
- **"Coming Up" panel** on the Control Center dashboard: items not yet in
  force, ordered by the soonest date that demands action, labelled *Comments
  close* vs *Effective* (an employer acts very differently on each) with a lead
  time. **Cal/OSHA items appear only for tenants with a facility or
  establishment in California.**

> **Operational caveat.** The Cal/OSHA fetch could not be exercised from the
> development environment — `dir.ca.gov` is blocked by the same egress policy
> as the rest of this review. The pass degrades gracefully and logs to Sentry
> if the source is unreachable, but **the first production run must be checked**
> (`/superadmin/cron`, then the panel): confirm the pages resolve from Vercel,
> and spot-check the extracted items against the live Standards Board page.
> DIR serves hand-tagged HTML with no rate-limit contract and reorganizes
> without notice, so treat `CAL_OSHA_SOURCES` as needing periodic review.

---

## Roadmap — not built {#roadmap}

Ordered by deadline, not by size.

### Tier 3a — HazCom 2024 readiness · **20 Nov 2026** · sequence first
Nearest hard deadline, cheapest build: it rides on modules that already exist.
A readiness tracker over the chemicals/SDS module (written program updated,
labels updated) plus a training course in the competency matrix for the
retraining requirement. Not a new module.

### Tier 3b — Cal/OSHA workplace violence · **1 Jan 2027**
Written plan, **violent incident log** with 5-year retention, hazard
identification and investigation records (5 years), annual training (1 year).
The log is a records table with a retention rule; the plan belongs in the
written-programs register below; the training reuses the existing matrix.

### Tier 3c — Heat · already enforceable
Written plan, 82°F/87°F trigger logic, cool-down area records, acclimatization
tracking for new and returning employees, and **temperature/heat-index
measurement records with 12-month retention**. The measurement log is the only
piece with no existing analogue.

### Tier 3d — A written-programs register · makes 3b and 3c cheap
§1910.147(c)(1) energy control program, IIPP §3203, HazCom, heat, WVP, silica,
lead — all are "a written plan, kept current, reviewed, with training and
records," and the platform has **no entity for a written program at all**.
`em385_requirements` (migration 228) already models exactly this shape:
catalog rows with `citation`, `record_type`, `retention_years`,
`renewal_interval_months`, `links_module`, seeded into a tracked register with
a `not_applicable` + justification state. Generalize it with a jurisdiction
column rather than building something new.

### Tier 4 — LOTO data model · wait for the NPRM
Task-based risk assessment, alternative methods, and safety-rated device
ratings — see [F1](#f1). Build against published text, not a projection.

**Two cheap wins available now, independent of the NPRM:**

- `loto_equipment.next_periodic_review_due_at` exists but **drives no reminder
  cron**, despite 22 crons in `vercel.json`. `training-expiry-reminders` is the
  template. Add a matching `SYSTEM_OBLIGATIONS` entry too — the compliance
  calendar seeds only three obligations and none is LOTO.
- The inspector bundle (`apps/web/app/api/inspector/bundle/route.ts`) and the
  compliance-bundle PDF (`lib/pdfBundle.ts`) ship confined-space and hot-work
  records only. **A Cal/OSHA inspector handed an inspector link sees no
  placards, periodic inspections, walkdowns, or group permits** — for the
  module that is this product's flagship.

### Also outstanding from the §1910.147 walk
No `affected_employee` role (§(c)(7)(i)(B)–(C) requires distinct training for
affected and other employees) · no first-class **energy isolating device**
entity (it lives as free text in `loto_energy_steps.tag_description`) · no
§(e)(3) lock-removal-by-others record · no tagout-only / §(c)(3) full-employee-
protection record · no §(a)(2)(ii) cord-and-plug or minor-servicing exemption
justification.

---

## Explicitly out of scope

Building heat, workplace-violence, or industrial-hygiene modules; the
task-based risk assessment model; and any change premised on the 2025–26
federal deregulatory package, **none of which is final**.
