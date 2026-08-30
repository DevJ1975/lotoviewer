# Changelog

All notable, user-visible changes to SoteriaField are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/runbooks/versioning.md](docs/runbooks/versioning.md) for how versions
are decided, bumped, and released. Per-tenant release notes also surface in the
app at `/superadmin/release-notes`.

## [Unreleased]

### Security
- **STRIKE quiz answers are no longer readable by learners.** The RLS policy on
  the quiz tables grants row-level read to any signed-in member, and Postgres
  RLS cannot filter columns — so while the learner page politely asked for only
  the answer text, anything holding a session could ask for `is_correct` and get
  the key for every published module. Column grants now withhold it (and the
  explanation text, which often paraphrases it) from browser-facing roles;
  grading has always been server-side and is unaffected. Explanations now come
  back with the graded result, for the questions you actually missed, instead of
  being rendered next to the question before you answered it.
- **Narration and audio files are no longer world-readable inside the shared
  library.** Media reads under the cross-tenant `global/` prefix only restricted
  video extensions, so any other file type was readable by every signed-in user
  of every tenant. Audio now follows the same rule as video.

### Fixed
- **A module with no quiz questions no longer records itself as passed.** Such a
  module scores 100% by definition, and the "I reviewed this" confirmation was
  only enforced in the browser — so a submission that skipped it still wrote a
  passing training record. The server now requires the acknowledgement.
- **Turning STRIKE off for a tenant now also turns off its APIs.** The module
  toggle was enforced on the pages but not the endpoints behind them, so a
  tenant without STRIKE still had working submit, playback, and assignment
  endpoints.
- **STRIKE assignment errors no longer echo database internals** to the caller.
  Every other STRIKE endpoint already returned a generic message.

### Fixed
- **Reset Demo no longer empties Equipment Readiness.** The reset wiped 31
  tables and re-seeded 17. Everything Equipment Readiness owns — inspections,
  their responses, defects, repairs and photo evidence — was in the first list
  and not the second, so every reset silently emptied the module and nothing
  put it back. A new seed restores a five-unit mobile fleet with inspections,
  three open defects and a repair returned to service. A wipe followed by a
  re-seed now leaves the tenant identical.
- **Reset Demo re-seeds any demo tenant, not just #0002.** The wipe ran against
  any tenant flagged `is_demo`, but the re-seed was gated on the tenant number.
  A second demo tenant was therefore emptied and never restored. The seeds
  resolve their own tenant by `is_demo`, so the number check was both wrong and
  redundant. (Audit item A10.)
- **A missing seed function is reported instead of silently skipped.** The
  response now carries `seedsMissing`, so a partially-migrated database is
  visible rather than quietly under-seeding.
- **The SSO setup page handed admins a callback URL that goes nowhere.** The SP
  ACS URL — the address your identity provider posts a sign-in to — defaulted to
  a path inside this application that does not exist. An admin who pasted it
  into Okta or Azure AD would have configured a dead endpoint and only found out
  when the first user tried to sign in. SAML is terminated by Supabase Auth, not
  by this app, so the field now defaults to the real Supabase endpoint, and is
  left blank rather than guessing when the deployment cannot determine it.
- **Fleet no longer advertises journey management.** The module description
  promised "monitored journey plans", which are not built — the module home
  already said "(coming soon)", but the drawer and catalog tile did not.
- **The Data Hygiene Log showed operator instructions to admins.** When the log
  could not load, the page told the reader to "run the data-hygiene SQL script
  first — the table is created in Section -1", which is a note to whoever runs
  the SQL, not to the admin reading the page. It now distinguishes three states
  properly: nothing logged yet, nothing matching the current filter, and a real
  load failure.

## [1.17.1] — 2026-07-31

A navigation and search release. The version is a patch, but the most visible
changes are in how you find things: search now covers equipment as well as
pages, module sub-pages are reachable without first opening the module, and
deep pages carry a breadcrumb trail.

### Added
- **Search finds equipment, not just pages.** ⌘K now searches pages, modules
  and equipment in one list. Before this, the only search box you could
  actually see queried equipment alone, while the thing that searched the other
  288 pages was invisible behind a keyboard chord — so typing "confined space
  permit" into the visible box returned nothing while the page sat one
  keystroke away. The header control now opens the same palette everything else
  uses.
- **Module sub-pages are reachable from the drawer.** Child pages — SDS
  Library, Tier II Report, MAQ Caps, Approval Queue and the rest — only
  appeared once you had already navigated into their module by some other
  route. The chevron beside a module is now a real disclosure control, and the
  open/closed choice is remembered per tenant.
- **Recents remembers the pages worth returning to.** An incident, a chemical
  or a piece of equipment used to vanish from Recents entirely, because the
  drawer could only name pages listed in its catalog and no catalog lists an
  id. Detail pages now resolve against the module that owns them.
### Added
- **Breadcrumbs on deep pages.** A page five levels down — say
  `/admin/people/contractors/<id>/prequalification` — rendered a title and
  nothing else, with a back arrow only when the page bothered to pass one.
  Every page using the shared `PageHeader` now derives its own trail from the
  feature and admin catalogs. That is **11 pages today** — nine under Fleet
  plus Incidents and Risk — and a module home renders no trail by design, so
  in practice the trail is visible on the deeper Fleet pages. It reaches the
  rest of the app as those pages adopt `PageHeader`; the derivation already
  handles routes far deeper than anything wired to it yet. Id segments are skipped rather than shown as raw
  UUIDs, the current page is not repeated (the heading already names it), and
  an admin *section* renders as text rather than a link, because
  `/admin/<section>` 301-redirects to `/admin` and a link there would send you
  further up than the crumb you clicked.

### Changed
- **One panel anatomy on the Control Center dashboard.** Eight panels
  hand-rolled the same six-line header, and the eyebrow's ad-hoc
  `text-[10px] font-bold uppercase tracking-widest` sat inches from siblings
  already speaking the placard vocabulary — two card geometries and two type
  scales on one screen. They now share a `DashboardPanel` built on
  `.placard-surface` / `.placard-label` / `.stencil-title`. The eyebrow/title
  split is kept: the eyebrow names the standard a panel answers to
  ("Risk Assessment · ISO 45001 6.1"), the title names the thing.
- **Incidents, Risk and LOTO adopt the shared primitives** — `PageHeader` for
  page titles on Incidents and Risk, `EmptyState` for zero-row and load-failure
  states, and the branded `OpsSpinner` in place of the generic spinner. LOTO
  takes `EmptyState` and `OpsSpinner` only: it is a three-panel workspace with
  no page title to head, so it has no `PageHeader` and therefore no breadcrumb
  trail. LOTO's failure state
  now reads "Offline" rather than the default "All Clear": an empty LOTO screen
  because the fetch failed is not the same as a tenant with no equipment, and
  in a safety product that distinction matters.
- Panel "view all" links gain a dark-mode colour. Brand navy on a dark slate
  surface was close to invisible; the navy/yellow pairing matches what the
  Active Permits panel already did one panel over.

### Changed
- **Administration is navigable again.** One oversized drawer group — larger
  than Pinned, Hazards and Permits combined — is now three: **People &
  Training**, **Platform & Integrations**, and **Records & Support**. Ten
  modules that had silently drifted into it are mapped explicitly, and a new
  build check fails if any module ever lands there by accident again.
- **⌘K has one owner.** Three global keyboard listeners were live at once, all
  intercepting the same chord and none aware of the others. It also now
  responds to Caps Lock and ⇧⌘K, and closes the palette when pressed a second
  time.

### Fixed
- **A malformed address in Recents could take the whole app down.** A path
  containing an incomplete percent-escape — `MIX-100%` is enough — threw while
  the drawer was rendering, replacing the entire application with an error
  screen. Because the address was already saved in Recents, it recurred on
  every reload until browser storage was cleared. The label now degrades to
  showing the raw text.
- **The command palette said "No matches." above real results.** Equipment rows
  were rendered outside the palette's own result set, so an exact equipment ID
  showed the empty-state message directly above the matching row — and pressing
  Enter activated an unrelated page rather than the equipment.
- **The command palette dialog is now named and described for screen readers.**
  It previously announced as an unnamed dialog. A first attempt at this fix was
  silently inert — the attribute used is not part of the accessibility
  standard, so it never reached the page — and it is now wired the supported
  way.
- Documentation and release tooling: the wiki-sync build check no longer lets
  one commit's exemption suppress the check for every later change, releases
  now include a tagging step (previously absent, which is why v1.9.0 through
  v1.17.0 shipped untagged), and a stale link in the multi-tenancy plan that
  pointed at a deleted file is corrected.

## [1.17.0] — 2026-07-30

### Added
- **Regulatory Watch now covers Cal/OSHA, and a "Coming Up" box says what's
  next.** The monthly regulation cron previously read only the Federal
  Register — where California rulemaking never appears — so a Cal/OSHA tenant
  saw nothing about the Title 8 changes that actually bind them. It now runs
  **two independent passes**: federal keeps the Federal Register API, and a new
  Cal/OSHA pass reads Standards Board rulemaking pages from `dir.ca.gov`,
  strips them to text, and extracts them under a **stricter prompt** (the
  source is scraped prose with no schema, so the model is forbidden from
  inferring any date the page does not state). Either source can be down
  without taking the other with it. A new **Coming Up** panel on the Control
  Center dashboard lists changes that are not yet in force, ordered by the
  soonest date that demands action and labelled *Comments close* vs *Effective*
  — an employer acts very differently on each — with the lead time alongside.
  **Cal/OSHA items reach only tenants with a facility or establishment in
  California**; federal items reach everyone. Migration 253 adds the
  `jurisdiction` dimension; the feed stays global because the *content* is the
  same for everyone — what differs is whether it applies, which is a read-time
  filter, not a reason to duplicate rows per tenant.
- **Regulatory review, July 2026** — a CSP-lens sweep of federal OSHA and
  Cal/OSHA at `docs/regulatory-review-2026-07.md`, mapping what changed and
  what is coming to the feature backlog, with per-item confidence marks and an
  explicit note that the primary sources could not be fetched from the review
  environment. Nearest hard deadline: **HazCom employee retraining, 20 Nov
  2026**.

### Fixed
- **California severe-injury reporting gave a 24-hour countdown where the law
  gives 8.** `reportingWindowHours()` encoded federal 29 CFR 1904.39 only — 8
  hours for a fatality, 24 for the rest — but Cal/OSHA (Lab. Code §6409.1(b),
  8 CCR §342) requires **8 hours for all four triggers**. A California tenant's
  countdown, status badge, and escalation were **16 hours too generous** on
  hospitalization, amputation, and loss of an eye. The window is now resolved
  from the incident's establishment and **frozen onto the row** (migration
  252), so re-pointing a facility later never moves a deadline someone was
  already held to; jurisdiction is a *required* argument, so a call site that
  forgets it fails to compile rather than silently reporting federal. Existing
  rows backfill to `federal` — they were tracked under that window, and
  recomputing history would retroactively mark past filings late. The form now
  also reflects California's constructive-knowledge basis ("knew, or with
  diligent inquiry would have known").
- **The LOTO audit agents cited a superseded consensus standard.**
  **ANSI/ASSP Z244.1-2024** supersedes Z244.1-2016 (R2020) and is a substantive
  revision: alternative methods are now a *co-equal* choice with
  lockout/tagout. The prompts now name the edition from one shared constant,
  and the EHS gate and Regulator carry an explicit rule that **conformance is
  not compliance** — OSHA does not accept Z244.1 alternative methods as a
  1910.147 path and §3314 rejects interlocks and PLC "softlock" as lockout, so
  when the standard and the regulation disagree, the regulation decides
  pass/fail.

## [1.10.0 – 1.16.0]

> These six releases shipped without being cut into versioned sections, so
> their entries accumulated under `[Unreleased]`. They are preserved verbatim
> here rather than split across versions after the fact: git history can settle
> which release each belongs to, but not cheaply, and guessing would be worse
> than grouping them honestly.

### Added
- **Drag-and-drop Events & Causal Factors, folded into Investigate & RCA.** The
  ECFA editor is now directly manipulable: drag to reorder events, and drag
  conditions between events and the above/below lanes, with the chart updating
  live. It is keyboard- and touch-accessible, built on the existing react-aria
  stack (no new dependencies). Events & Causal Factors is now a **sub-view of
  the Investigate & RCA tab** rather than a separate tab — the old
  `/incidents/[id]/ecfa` route redirects there — unifying all causal analysis
  in one place.
- **Scorecard analytics upgrade — statistical rigor + a cross-module risk
  engine.** The incident-risk model (the site-health score on the EHS
  Scorecard) is now **v2.0.0**: beyond incidents / CAPA / risk / training /
  atmospheric, it reads six new cross-module leading indicators — failing
  **inspections**, open **BBS-v2** follow-ups, overdue **JHA** reviews,
  **permits** left open past expiry, competency-matrix **training gaps**
  (`v_training_matrix`), and **ECFA causal factors coded to weak controls** —
  each gathered best-effort so a tenant without a module simply contributes no
  pressure. A new **Leading Indicator Signals** panel (deterministic
  `laggedCorrelation`) surfaces which leading indicators actually *precede* a
  tenant's recordables, and by how many months, presented explicitly as
  exploratory correlation. OSHA rates on the incident scorecard now render
  **confidence intervals** (Poisson for rates, Wilson for RCA completion) so a
  handful-of-events rate no longer reads as precise. Adds a short-TTL memo on
  the risk gather and migration 245 (supporting indexes). Reuses the existing
  statistics/forecast core (`wilsonInterval`, `rateInterval`,
  `laggedCorrelation`) rather than new machinery.
- **Events & Causal Factors Analysis (ECFA).** A new **Events & Causal
  Factors** tab on every incident charts the investigation as a chronological
  timeline — events (rectangles), conditions (ovals) attached above/below, and
  the terminal loss (diamond) — reading left→right. Every node tracks
  **verified vs. presumptive** status (solid vs. dashed) so the chart separates
  fact from assumption. Flagged **causal factors** are coded by category (ICAM
  taxonomy), failed/missing barrier, and hierarchy-of-controls level, and turn
  in one click into a tracked corrective action
  (`incident_actions.source_ecfa_node_id`). An optional, **human-approved**
  Claude co-pilot drafts the event sequence from the narrative and suggests
  causal factors; nothing is written until a person accepts it, and accepted
  text is badged. An advisory **investigation-quality score** surfaces gaps, and
  the incident scorecard gains a **causal-factor trends** panel (by category and
  control level). Rendered as dependency-free SVG from a pure layout function.
  Migration 244 adds `incident_ecfa_nodes`, `incident_ecfa_ai_suggestions`, and
  the `source_ecfa_node_id` link; new wiki page at `/wiki/ecfa`.
- **5 Whys retired.** Following the ECFA rollout, the 5 Whys RCA method is no
  longer offered for new investigations. Existing 5 Whys investigations remain
  visible **read-only** (no data is removed); Fishbone / TapRooT / ICAM stay
  available, and ECFA supersedes 5 Whys for causal analysis.
- **Fix:** AI-drafted corrective actions are now badged in the database — the
  `actions` route persists the `ai_origin` / `ai_edited` provenance the client
  already sent (previously dropped on insert).
- **AI-assisted root cause analysis (incident 5 Whys, rebuilt).** Acting on
  feedback that the old tool "is not a good tool," the 5 Whys editor now writes
  contextual prompts that chain each "why" to the answer above it, supports
  branching and **multiple** identified root causes, and shows an inline
  anti-blame guardrail that flags symptom-level / person-blaming answers
  (HOP / Safety-II aligned). An optional, **human-approved** Claude co-pilot
  suggests the next "why" and drafts a root cause + corrective actions — nothing
  is written until a person accepts it, and accepted AI text is badged. The
  investigation is unified: the RCA editor moved into the **Investigate & RCA**
  tab, identified roots pull into the narrative in one click and into tracked
  corrective actions (`incident_actions.source_rca_node_id`), and the old
  `/incidents/[id]/rca` tab redirects there. Migration 234 adds 5-Whys
  branching, multi-root support, and AI provenance; new wiki page at
  `/wiki/incident-investigation`.
- **Public QR placard view** (`/qr/{qr_token}`) — scanning a printed placard QR
  opens a read-only, no-login view of that machine's isolation photo (with
  annotation markers), ordered energy-control steps, and verified badge. Reads
  flow through a `SECURITY DEFINER` RPC granted to anon (the service key never
  reaches the browser; RLS unchanged); each resolved scan is logged.
- **Reviewer photo staging + admin reconcile** — on the public review portal,
  replacing an ISO/EQUIP photo now *stages* the upload with a "pending
  reconcile" badge instead of writing the placard live. An admin applies or
  rejects each one from `/admin/loto/public-review-link` → "Photo
  replacements" (side-by-side old vs new, Apply / Reject / Apply all);
  applying swaps the photo, clears the stale placard for re-render, and writes
  audit + hygiene-log rows. Idempotent — re-running never double-applies.
- **"Update photo" deep-link** — the public placard view links into the review
  portal *focused on that one machine* (`?equipment=<id>`), so a field worker
  can replace a photo from a single scan without loading the full floor-walk
  batch page.
- Weekly reminder emails for invitees who haven't signed up, with reversible
  soft-cancel after four reminders (daily `/api/cron/invite-reminders`).
- First-login onboarding instruction walkthrough for new users.
- Version-control scheme: `check:version` drift guard, this changelog, and the
  versioning runbook.

### Notes
- **Planned — LOTO verification-packet report generator.** The printed packet's
  per-placard QR codes were repointed to the new `/qr/{qr_token}` convention
  (cover/sign-off QR → the public `/review` link) out-of-band via a PyMuPDF +
  `qrcode` script. This packet assembly + QR-stamping pipeline is the
  groundwork for an in-app **report generator** that builds and refreshes the
  verification packet from live equipment data.

## [1.9.0]

Baseline release. Earlier history is tracked in git and in the in-app release
notes (`/superadmin/release-notes`); this changelog starts the forward record
from 1.9.0.

[Unreleased]: https://github.com/devj1975/lotoviewer/compare/v1.17.1...HEAD
[1.17.1]: https://github.com/devj1975/lotoviewer/compare/v1.17.0...v1.17.1
[1.17.0]: https://github.com/devj1975/lotoviewer/compare/v1.16.0...v1.17.0
[1.10.0 – 1.16.0]: https://github.com/devj1975/lotoviewer/compare/v1.9.0...v1.16.0
[1.9.0]: https://github.com/devj1975/lotoviewer/releases/tag/v1.9.0
