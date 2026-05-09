-- Migration 108: publish the first seven user manuals.
--
-- Replaces the placeholder body_md stubs from seed_module_manuals.sql
-- with real content for the seven safety modules workers and
-- supervisors hit most:
--   loto, chemicals, risk-assessment, confined-spaces,
--   incidents, jha, toolbox-talks
--
-- Each row gets:
--   - a tightened summary (one-line index blurb)
--   - a quick-reference body_md (~100-150 lines)
--   - published_at = now() so non-superadmin users see them
--
-- Idempotent: only overwrites rows that still carry the
-- "**Edit me.**" stub. Re-running won't clobber subsequent edits a
-- superadmin makes through /superadmin/manuals/[moduleId]. The
-- BEFORE-UPDATE trigger from migration 080 archives the prior stub
-- into manual_versions, so the v1 ("Edit me.") draft stays in the
-- per-manual changelog.
--
-- Markdown is dollar-quoted ($manual$...$manual$) — single quotes,
-- backticks, and apostrophes pass through verbatim. The renderer at
-- lib/manuals/markdown.ts handles GFM (headings, lists, tables, code
-- spans, links).

begin;

-- ────────────────────────────────────────────────────────────────────
-- LOTO — Lockout/Tagout
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$Lockout/Tagout: equipment placards, energy-isolation procedures, sign-on, and inspector review.$$,
  body_md      = $manual$
## Overview

The LOTO module is your control-of-hazardous-energy program in software. It captures every piece of energy-isolating equipment, the placard that lives on the machine, the written procedure a qualified person follows, and the sign-on records that prove the work was done safely.

Compliance frame: **OSHA 29 CFR 1910.147** (the lockout/tagout standard) and **ANSI/ASSP Z244.1**. Soteria is a drafting and reference tool — a qualified person must verify isolation and authorize the work.

## Who uses it

- **Authorized workers** scan a placard before service, read the procedure, lock the equipment out, and sign on.
- **Supervisors** review and approve drafts, audit sign-ons, and pull the inspector view for an outside auditor.
- **Safety leads** use the AI step generator to draft procedures for new equipment, then route them through qualified-person review.

## Common workflows

### Adding a new piece of equipment

1. From the LOTO dashboard, **Add equipment**.
2. Fill in equipment ID, description, department, and (optionally) the placard's public warning text.
3. Hit **Generate steps with AI** — Soteria proposes one isolation step per independent energy source (electrical, pneumatic, hydraulic, gas, mechanical, compressed gas).
4. Review every step. Edit anything ambiguous or wrong. The AI is a draft, never the authority.
5. Save. The procedure is now visible on the placard scan view.

### Servicing equipment in the field

1. Scan the QR code on the placard with the assistant dock or `/scan`.
2. Soteria opens the procedure for that exact piece of equipment.
3. Walk the steps top-to-bottom. Each step lists the energy source, the physical isolation action, the lock/tag attachment point, and the verification test.
4. Sign on when isolation is verified zero-energy.
5. Sign off when the work is complete and energy is restored.

### Sending a procedure to an outside inspector

1. Open the equipment detail page.
2. **Inspector view** → **Send link**. Soteria generates a tokenized read-only URL that expires in 14 days.
3. Email the link to the inspector. They see the procedure, sign-on log, and any attached photos — no Soteria login required.
4. The inspector can leave a written note that lands back on the equipment record.

## Tips & gotchas

- **Energy source codes are exact.** Use `E` (electrical), `G` (gas), `H` (hydraulic), `P` (pneumatic), `N` (none — formal absence), `O` (mechanical), `OG` (compressed gas like CO₂/N₂). The AI honours this exactly; manual edits should too.
- **Stored energy is the most-missed hazard.** The AI flags VFD DC-bus capacitors, trapped pneumatic volume, hydraulic accumulator pressure, hot CIP residuals, and gravity loads. Don't strip these in review unless you've physically confirmed they don't apply.
- **A draft procedure is unsigned.** Workers can read drafts, but they cannot sign on against a draft. Always promote to **Active** before the equipment goes back online.
- **Placards print from the equipment detail page.** Use the printable placard view; it embeds a fresh QR token tied to that equipment.

## Related modules

- **JHA** — when a procedure surfaces a residual hazard not addressed by isolation, escalate it to a Job Hazard Analysis.
- **Chemicals** — CIP and chemical-jacket isolation references the Chemicals module's stored hazards.
- **Incidents** — a near-miss or recordable incident on equipment that has a LOTO procedure should link back to the equipment record so the procedure can be revised.

## FAQ

**Can a non-qualified person edit a procedure?**
No. Procedure edits are gated by the qualified-personnel role. The AI generator is available to anyone, but the resulting draft must be reviewed and signed by a qualified person before it goes active.

**What happens if I delete equipment with sign-on history?**
Soteria archives the procedure and history rather than hard-deleting. Sign-ons remain in the audit log; the equipment is hidden from the active list.

**Why does the AI sometimes write "Assuming X — verify on site before use"?**
When the description is ambiguous about the specific configuration (e.g. single-feed vs. dual-feed MCC), the AI proposes the most common arrangement and flags the assumption. Always verify on the placard.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'loto'
  and (body_md like '%**Edit me.**%' or body_md = '');

-- ────────────────────────────────────────────────────────────────────
-- Chemicals
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$GHS-aligned chemical inventory, SDS upload + AI parse, drift monitoring, MAQ and tier-two reporting.$$,
  body_md      = $manual$
## Overview

The Chemicals module is your hazard-communication program in software: every product on site, the SDS that backs it, the GHS pictograms and signal word it carries, where it's stored, and how much you have. AI-assisted SDS parsing turns a 14-page PDF into structured fields in about 30 seconds.

Compliance frame: **OSHA 29 CFR 1910.1200** (HazCom 2012 / GHS), **EPA Tier II / EPCRA 312**, **DOT 49 CFR** for transport. Maximum allowable quantities (MAQ) feed the **IFC / IBC** life-safety analyses.

## Who uses it

- **Workers** scan a chemical's QR label to read the SDS hazards, required PPE, and storage compatibility — without leaving the floor.
- **Stockroom / receiving** logs containers in and out, prints GHS labels, and triggers SDS-revision review when a supplier ships a newer rev.
- **Safety / compliance** owns the SDS library, runs the drift monitor, generates Tier II reports, and reviews AI-parsed SDS extractions before they go active.

## Common workflows

### Adding a new chemical

1. **Chemicals → Add product**. Enter name, manufacturer, product code, CAS numbers, GHS pictograms, and signal word.
2. Drop the SDS PDF into the upload zone (≤25 MB). Soteria stages it and runs the AI parser.
3. The parsed payload (hazards, transport class, storage requirements, NFPA codes) lands in the **review queue** as `parse_review_status = pending`.
4. Open the review queue, compare the AI fields to the SDS, accept or correct.
5. Save. The chemical is now visible to inventory, scan, and the assistant.

### Tracking inventory + locations

- **Inventory** lists every container by location, lot, and quantity.
- **Locations** maps storage areas to compatibility classes (flammables in a flammables cabinet, oxidizers separate from organics, etc.).
- Restocks are entered manually or via the receiving wizard. The MAQ check fires on save and warns if a location would exceed code-allowable limits.

### Running SDS drift detection

1. From the chemical detail page, hit **Check for newer SDS revision**.
2. Soteria queries the manufacturer's published SDS index and compares the date to the active rev on file.
3. If a newer rev exists, you'll see a **drift detected** banner and a one-click upload link.
4. Upload the new rev — it parses through the same AI pipeline and the previous rev is archived.

### Tier II / EPCRA reporting

- **Approvals → Tier Two** rolls up every chemical that crosses the EPA reportable-quantity threshold for the reporting year.
- Export as the standard Tier II Submit XML or as a printable summary PDF.
- The compliance bundle (under Reports) includes the Tier II export.

## Tips & gotchas

- **GHS pictograms and signal words must match the SDS.** The label printer reads from these fields; an inaccurate pictogram on a label is a HazCom violation.
- **SDS PDFs over 100 pages are rejected by Anthropic.** Split long combined SDS booklets into per-product PDFs before upload.
- **Scanned-image PDFs without OCR fail extraction.** Run them through OCR (Acrobat → Recognize Text) first, or paste the text as `.md`.
- **Restricted chemicals** (Restricted tab) hide from non-admin users. Use this for DEA list 1, controlled precursors, or anything your tenant deems sensitive.
- **Container-level tracking is optional.** Tenants that don't need inventory granularity can leave containers blank and just track the product master.

## Related modules

- **LOTO** — chemical-jacket isolation steps reference the chemical record's hazards.
- **JHA** — chemical-handling tasks pull the GHS hazards into the JHA hazard list.
- **Incidents** — chemical exposure or release incidents link back to the product for trend analysis.

## FAQ

**The AI extracted the wrong CAS number — can I correct it without re-uploading?**
Yes. From the SDS revision row, hit **Edit parsed payload**. Your edits are saved as a manual override and don't get clobbered by re-runs.

**Can two products share an SDS?**
Yes — link them via product alias. Common for re-branded distributor products that ship under multiple SKUs but share a manufacturer SDS.

**Where do I enter MAQ limits per location?**
**Locations → edit location → maximum allowable quantities**. Defaults seed from IFC Table 5003.1.1 (flammable, combustible, oxidizer, etc.); override per location as your AHJ requires.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'chemicals'
  and (body_md like '%**Edit me.**%' or body_md = '');

-- ────────────────────────────────────────────────────────────────────
-- Risk Assessment
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$ISO 45001 6.1 risk register: scoring, controls hierarchy, residual risk, heat map.$$,
  body_md      = $manual$
## Overview

The Risk Assessment module is your **ISO 45001 clause 6.1** risk register: every hazard you've identified, the controls in place, the residual risk after those controls, and the trail of decisions that got you there.

It models the **hierarchy of controls** (Elimination → Substitution → Engineering → Administrative → PPE) and computes a 5×5 likelihood × consequence score before and after controls. The heat map gives a one-glance read on tenant-wide risk exposure.

## Who uses it

- **Department leads** own their risks. They identify hazards, document existing controls, and propose new controls.
- **Safety leads** review and approve, run the heat map, and export the register for audits.
- **Workers** see the risks relevant to their tasks via the JHA module — most workers don't open Risk directly.

## Common workflows

### Adding a risk

1. **Risk → New risk**. Pick the activity / hazard category and write a one-line title.
2. **Hazard description** — what's the actual harm? Be specific: not "ergonomic" but "repeated lifting of 25 kg flour bags from floor to shoulder, six hours per shift."
3. **Inherent score** — likelihood (1-5) × consequence (1-5) before any controls. This is the unmitigated risk.
4. **Controls** — list each control by hierarchy level. Engineering before administrative; administrative before PPE.
5. **Residual score** — likelihood × consequence after the listed controls. The heat map shades by this number.
6. Save and route for review.

### Reading the heat map

- The heat map plots **likelihood (X)** vs. **consequence (Y)**, colour-coded **green / amber / red**.
- Each cell shows the count of risks at that score. Click a cell to drill in.
- Filters: by department, by category, by owner, by control hierarchy level.
- The "drift over time" lens shows how the register has shifted across the last four quarters.

### Importing from a spreadsheet

If you're migrating an existing register from Excel:

1. **Risk → Import**. Download the CSV template.
2. Map your columns to Soteria's. The importer is permissive — extra columns are ignored.
3. Dry-run preview. Fix any rows flagged with validation errors.
4. Commit. Imported rows land in `pending` status until a safety lead approves them.

### Exporting for audit

- **Export** produces a printable PDF with the full register, heat map snapshot, and an appendix of controls. Suitable as evidence for an ISO 45001 internal or external audit.
- The compliance bundle (under Reports) includes this export.

## Tips & gotchas

- **Inherent vs. residual is the audit point.** ISO 45001 auditors want to see both numbers and the gap between them. A row with inherent = residual is suspicious — your "controls" probably aren't actually reducing risk.
- **Hierarchy of controls matters.** A row that lists only "PPE" as a control will get flagged for re-review on its next due date. Engineering and administrative controls always come first.
- **Risks have owners.** Every row needs a named owner; unowned risks fall off the radar.
- **Re-review cadence is set by score.** Red cells review every 6 months; amber every 12; green every 24. The dashboard surfaces overdue rows.

## Related modules

- **JHA** — task-level hazard analysis. JHA findings can be escalated to a Risk register entry when they affect a whole class of work.
- **Incidents** — every recordable incident should link to the Risk register row for that hazard. If no row exists, that's a register gap.
- **LOTO** — energy-isolation procedures are a control listed against electrical / mechanical / pneumatic risks.

## FAQ

**What's the difference between a risk and a JHA?**
A **risk** is a category of hazard at the program level ("manual handling in receiving"). A **JHA** is a specific task-level analysis ("unloading 25 kg flour from pallet to mixer"). One risk can spawn many JHAs.

**Can I weight likelihood and consequence differently from 5×5?**
The matrix is fixed at 5×5 to keep cross-tenant comparisons valid. If your existing register uses 3×3 or 4×4, the importer maps it.

**How do I retire a risk?**
**Edit → Status → Retired**, with a justification. Retired rows stay in the audit trail but drop off the heat map.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'risk-assessment'
  and (body_md like '%**Edit me.**%' or body_md = '');

-- ────────────────────────────────────────────────────────────────────
-- Confined Spaces
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$Permit-required confined space program: registry, hazard analysis, permits, atmospheric testing.$$,
  body_md      = $manual$
## Overview

The Confined Spaces module is your **OSHA 29 CFR 1910.146** permit-required confined space (PRCS) program. It catalogues every space on site, classifies each as permit-required or non-permit, drives the entry-permit workflow, and captures atmospheric testing results.

A space is **permit-required** if it contains or has the potential to contain a hazardous atmosphere, contains material that could engulf an entrant, has an internal configuration that could trap or asphyxiate, or contains any other recognized serious safety hazard.

## Who uses it

- **Authorized entrants** read the entry permit, perform pre-entry atmospheric tests, and sign on/off.
- **Attendants** stay outside the space, monitor the entrants, and maintain communication.
- **Entry supervisors** issue, validate, and close out permits.
- **Safety leads** maintain the space registry, audit closed permits, and run hazard analyses for new spaces.

## Common workflows

### Adding a space to the registry

1. **Confined Spaces → Add space**. Enter location, dimensions, normal contents, access points.
2. **Hazard analysis** — Soteria's AI proposes the §1910.146-grounded hazard list (oxygen deficiency, flammable atmosphere, toxic exposure, engulfment, configuration). Review and edit.
3. **Classification** — permit-required or non-permit. Soteria flags any space the AI thinks is misclassified.
4. Save. The space gets a QR placard for field scan-to-permit.

### Issuing a permit

1. From the space detail page or by scanning the placard, **Issue permit**.
2. The permit auto-loads the space's hazard list and required PPE.
3. **Atmospheric testing** — record initial reads for O₂, LEL, H₂S, CO. The permit blocks sign-on if any reading is outside the acceptable range.
4. List authorized entrants, attendant, entry supervisor.
5. Issue. The permit is valid for the shift duration you set (default 8 hours).

### During the entry

- Entrants sign on as they enter; sign off as they exit.
- Atmospheric re-tests are required at the cadence the permit specifies (typical: every 30 minutes for IDLH spaces, every hour otherwise).
- The attendant logs communication checks.
- If any atmospheric reading goes out of range, the permit auto-suspends and Soteria triggers an evacuation alert.

### Closing the permit

- Entry supervisor closes when all entrants are out, the space is reclassified as ready for normal use, and any deviations are noted.
- Closed permits land in the audit log indefinitely.

## Tips & gotchas

- **Atmospheric ranges aren't editable per-space.** The permit enforces OSHA-grounded defaults: O₂ between 19.5% and 23.5%, LEL below 10%, H₂S below 10 ppm, CO below 35 ppm. If your AHJ requires tighter limits, set those at the tenant level.
- **Reclassification of a space is not a permit decision.** Reclassifying from permit-required to non-permit requires written hazard control evaluation. Soteria captures this as its own workflow, not as a permit step.
- **Photo documentation matters.** Attach a pre-entry photo to every permit; it's the cheapest evidence in an audit dispute.
- **Rescue capability is a permit field.** "Self-rescue" is rarely acceptable for IDLH spaces — list a real rescue plan or a contracted rescue service.

## Related modules

- **LOTO** — most permit-required spaces require energy isolation before entry. The permit links to the relevant LOTO procedure.
- **JHA** — task-specific JHAs (e.g. welding inside a tank) attach to the permit.
- **Incidents** — confined-space incidents link back to the space and the permit for root-cause review.

## FAQ

**Can I use Soteria for non-permit confined spaces?**
Yes. Non-permit spaces still benefit from the registry and hazard analysis; the permit workflow simply isn't required.

**What happens if a sensor fails the 30-minute re-test?**
The permit auto-suspends and the assistant alerts the attendant + entry supervisor. Entrants must evacuate; permit can't resume until a fresh acceptable reading is logged.

**Does Soteria support continuous gas monitor integrations?**
Manual logging today; a future release wires Bluetooth-paired monitors directly into the permit's atmospheric log.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'confined-spaces'
  and (body_md like '%**Edit me.**%' or body_md = '');

-- ────────────────────────────────────────────────────────────────────
-- Incidents
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$Incident reporting, investigation, OSHA 1904 recordability, lessons learned, scorecard.$$,
  body_md      = $manual$
## Overview

The Incidents module captures every workplace event that requires a record — first aid, recordable injury, near-miss, property damage, environmental release. It runs each event through the **OSHA 29 CFR 1904** recordability wizard, drives a structured investigation, and rolls findings up into the scorecard for trend reading.

## Who uses it

- **Anyone on the floor** can file a report. The mobile-friendly form is intentionally short — capture facts, not blame.
- **Supervisors** triage new reports, assign investigators, and close out the immediate corrective actions.
- **Safety leads** run the recordability wizard, build the OSHA 300 / 300A / 301 logs, publish lessons learned, and read the trend scorecard.

## Common workflows

### Filing a report

1. From any screen, **Report incident** (the floating button or the assistant dock).
2. Pick the type: injury, property damage, environmental, near-miss.
3. Describe what happened in plain language. Photos are optional but helpful.
4. Identify the people involved, the equipment, the location, and the time.
5. Submit. The report is **anonymously postable** if your tenant has that toggle on — useful for a worker who wants to flag a hazard without their name attached.

### Running the recordability wizard

1. Open the report. **Run recordability check**.
2. The AI walks the §1904 decision tree: was it work-related? Did it result in death, days away, restricted duty, medical treatment beyond first aid, loss of consciousness, or significant injury / illness?
3. The wizard returns a recommendation (record / don't record) with reasoning grounded in the standard.
4. A safety lead reviews and signs off. The recommendation is a draft — the human signs the call.

### Investigating

1. Assign an investigator from the report.
2. The investigation form captures the **5 Whys** root-cause chain, contributing factors, and corrective actions.
3. Each corrective action is owned, due-dated, and tracked. Overdue CAs surface on the scorecard.
4. Publish a **lesson learned** when the investigation is closed — visible to every tenant member, useful for sharing across shifts.

### Reading the scorecard

- **Lagging indicators**: TRIR (Total Recordable Incident Rate), DART (Days Away, Restricted, Transfer), severity.
- **Leading indicators**: near-miss reports per worker per quarter, corrective-action completion rate, JHA reviews completed.
- Trends shown over the last 4 quarters with year-over-year deltas.
- Drill in on any number to see the underlying records.

## Tips & gotchas

- **First aid is not recordable.** Bandage, single-dose OTC analgesic, ice — none of these trigger §1904. The wizard knows this; trust it.
- **Restricted duty is recordable.** A worker on light duty for one shift counts as a DART case.
- **Environmental releases have their own thresholds.** A reportable quantity (RQ) release under EPCRA is a separate compliance event; Soteria flags it but doesn't file the §304 notification for you.
- **Anonymous reports are read-only for the reporter.** Once submitted, the original reporter can't edit — by design, so there's no pressure to walk back a hazard call.
- **Don't close an investigation without a corrective action.** A closed investigation with zero CAs flags on the next safety committee dashboard.

## Related modules

- **Risk Assessment** — every recordable incident should link to a Risk register entry. If it doesn't link, the register has a gap.
- **JHA** — incidents on tasks with a JHA may indicate the JHA needs revision.
- **Toolbox Talks** — published lessons learned auto-suggest as toolbox talk topics for the following Monday.

## FAQ

**The AI says "don't record" but I'm not sure. Should I still record?**
When in doubt, record. §1904 is forgiving on over-recording; under-recording is the violation. The wizard is a draft.

**How do I correct a recordability call after it's been signed?**
**Edit → Reclassify**. The change is logged; OSHA 300 log re-renders.

**Can I file an incident on behalf of a worker who isn't in Soteria?**
Yes. The form has a "person not in Soteria" path. Enter their name and (optional) employee number; the report stays in the worker's department for follow-up.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'incidents'
  and (body_md like '%**Edit me.**%' or body_md = '');

-- ────────────────────────────────────────────────────────────────────
-- JHA — Job Hazard Analysis
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$Job Hazard Analysis library: task-step decomposition, hazards, controls, signed worker review.$$,
  body_md      = $manual$
## Overview

A Job Hazard Analysis (JHA) — sometimes called a Job Safety Analysis (JSA) — is a structured walk-through of a specific task, step by step, with the hazards present at each step and the controls that mitigate them. The JHA module is your library of these documents: searchable, signable, linkable.

JHA is task-level. **Risk Assessment** is program-level. A risk like "manual handling in receiving" can spawn many JHAs ("unloading flour from pallet to mixer," "loading finished cartons onto a truck," etc.).

## Who uses it

- **Workers** read the JHA before performing the task. Tap-through sign-off is supported.
- **Crew leads** author and revise JHAs for the tasks their crew runs.
- **Safety leads** approve, audit, and link JHAs to risks and incidents.

## Common workflows

### Authoring a JHA

1. **JHA → New JHA**. Pick the activity / department. Title it crisply: "Unload flour pallets from truck to dry-storage receiving bay."
2. **Step decomposition** — break the task into 5-15 sequential steps. Each step is a single observable action.
3. For each step, list:
   - **Hazards** (slip, struck-by, ergonomic, chemical, electrical, etc.)
   - **Controls** in the hierarchy of controls order (Elimination → Substitution → Engineering → Administrative → PPE)
   - **Required PPE** explicitly
4. Attach photos of the workspace if helpful.
5. Submit for safety-lead approval. Approved JHAs become the active version.

### Reviewing a JHA in the field

- A worker scans a placard or opens the JHA from the assistant dock.
- The JHA renders step-by-step with the hazards highlighted.
- **Sign on** when reviewed; the sign-on is the proof point in an audit. Time-stamped, worker-attributed.
- A worker can flag a JHA as **out of date** if the task has changed — the flag opens a revision request to the author.

### Revising a JHA

1. **Revise** opens a working draft of the active version.
2. Edit, add, remove steps as needed.
3. Save. The prior version is archived; sign-ons against the prior version remain in the audit log.
4. Workers see a **JHA updated** flag the next time they open it; they re-sign-on against the new version.

### Linking to risks and incidents

- From the JHA edit view, **Link to Risk register** picks the program-level risk this JHA addresses.
- An incident filed against a JHA's task automatically suggests linking back. A pattern of incidents on a single JHA's steps is a strong signal that the JHA needs revision.

## Tips & gotchas

- **Generic JHAs aren't useful.** A JHA titled "warehouse work" with hazards "various" is a checkbox, not a control. Be specific to the task.
- **Steps are sequential.** Don't compress two parallel actions into one step — the hazard analysis gets muddy.
- **PPE alone is rarely enough.** A JHA whose only control is "wear gloves" will get bounced in review. Show engineering or administrative controls first.
- **Sign-ons are versioned.** A worker who signed v3 last week needs to re-sign v4 when it lands. The dashboard surfaces stale sign-ons.
- **Photo evidence helps.** A photo of the workspace, the equipment, or the hazard itself makes the JHA much more readable in the field.

## Related modules

- **Risk Assessment** — each JHA links upward to one or more program-level risks.
- **LOTO** — task steps that involve energy isolation reference the relevant LOTO procedure rather than re-stating the steps.
- **Incidents** — incidents on JHA-covered tasks link the incident record to the JHA so trend analysis can surface JHAs that need revision.

## FAQ

**How often should JHAs be reviewed?**
Annually at minimum, immediately after any incident on the task, and whenever the task itself changes (new equipment, new chemical, layout change).

**Can the AI generate JHAs?**
Today the AI generates LOTO procedures and confined-space hazards. JHA generation is on the roadmap and currently goes through the home-page assistant on a per-step basis.

**Worker signed on, then the JHA was revised. Do they need to re-sign?**
Yes. The system marks the prior sign-on as superseded and prompts the worker on next open. Their signing history is preserved.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'jha'
  and (body_md like '%**Edit me.**%' or body_md = '');

-- ────────────────────────────────────────────────────────────────────
-- Toolbox Talks
-- ────────────────────────────────────────────────────────────────────
update public.manuals set
  summary      = $$AI-generated daily toolbox talks: 5-minute pre-shift safety briefings with crew sign-in roster.$$,
  body_md      = $manual$
## Overview

A toolbox talk is a 5-to-8 minute pre-shift safety briefing a foreman delivers to a crew at the start of the day. The Toolbox Talks module generates one per day, per tenant, automatically — grounded in your industry, citing the relevant regulation, and ready to hand to the foreman without a writing chore.

Talks are written by the assistant on Sunday at 00:00 EST for the upcoming week. The foreman reads, the crew signs in, and the sign-in roster is the audit evidence that the briefing happened.

## Who uses it

- **Foremen** open today's talk at huddle, deliver it, and pass the iPad around for sign-in.
- **Crew members** sign in (one tap) when the talk is delivered.
- **Safety leads** review the topic pool, override individual talks if a site-specific event needs to be covered, and audit attendance.

## Common workflows

### Delivering today's talk

1. **Toolbox Talks → Today** at the start of shift.
2. Read the talk aloud. Each talk includes:
   - A short anecdote or near-miss vignette (makes the hazard memorable)
   - The hazard explanation in plain language
   - Specific behaviours: what to do, what to avoid
   - Citations to the relevant OSHA, ANSI, NFPA, or NIOSH standard
   - A "Today's commitment" line the crew can repeat aloud
3. Pass the iPad around for sign-in. Each crew member taps their name.
4. The supervisor closes the roster. Attendance is logged.

### Customising a talk

If the auto-generated talk doesn't fit (site-specific event, recent near-miss to address, seasonal hazard):

1. **Today → Edit**.
2. Rewrite, replace, or augment the body. Keep it under 700 words for a 5-minute delivery.
3. Save. Your edits are tagged as a manual revision; the original AI draft stays in the version history.

### Choosing the industry pool

- **Settings → Toolbox industry**. Default is `general`. Switch to `dairy`, `baking`, `beverage`, `meat-processing`, `frozen`, `packaging`, etc. as those topic packs ship.
- The cron picks topics from your industry's pool, weighted by recency — most-recent topic gets least weight, least-recent topics most. So you don't see "fall protection" three weeks running.

### Reviewing attendance

- **Toolbox Talks → Roster** shows attendance per talk per crew per shift.
- Filter by date range, by department, by crew member.
- A worker who's missed more than 3 talks in a quarter shows on the safety-lead dashboard.

## Tips & gotchas

- **Talks are generated weekly, not daily, on Sunday.** If the cron misses (rare — Vercel guarantees ≥1 fire per schedule slot), the next morning's talk auto-generates on first open.
- **Edit the talk, not the topic.** Editing the body for today's delivery is fine. Editing the underlying topic in the pool changes future generations across all tenants on that pool — only do this if you maintain the pool itself.
- **Sign-in is one tap.** Don't make workers type a signature; the time-stamp + worker ID is the legally sufficient record.
- **The talk is a starting point, not a script.** The best foremen riff on the talk with site-specific examples. Encourage that.

## Related modules

- **Incidents** — published lessons learned from recent incidents auto-suggest as toolbox talk topics for the following Monday.
- **JHA** — talks reference relevant JHAs when the topic is task-bound (e.g. lifting, hot work).
- **Chemicals** — chemical-handling talks pull GHS hazards from the chemical record so the language matches the SDS.

## FAQ

**Can we deliver the same talk to two crews on the same day?**
Yes — the roster is per-crew. Open the talk for each crew separately and run the sign-in twice.

**Is there a template for monthly safety committee briefings?**
Toolbox Talks are daily by design. Use the assistant's chat to generate longer-form briefings for committee meetings.

**How do I propose a new topic for the industry pool?**
**Settings → Toolbox industry → Suggest topic** opens a form. Suggestions land in the platform's topic-curation queue and ship in the next industry-pack release.
$manual$,
  published_at = coalesce(published_at, now()),
  updated_at   = now()
where module_id = 'toolbox-talks'
  and (body_md like '%**Edit me.**%' or body_md = '');

commit;
