# Module 2 — Integrity / CAPA / ISO 45001 Smoke Test

Goal: verify the six Module 2 subareas (sealed PDFs, retention + legal
holds, CAPA verification, hierarchy of controls on escalation, ISO 45001
clause-evidence, AI severity prediction) work end-to-end before running
Module 3. Run as a tenant admin on a non-prod tenant.

## A — Sealed PDF audit artifacts

1. Open the existing client review portal flow: from any department
   detail page, click **Send for client review** → enter a reviewer
   email → send the tokenized link.
2. Open the link in another browser, review the placards, type a name,
   draw a signature, click **Submit signoff**.
3. Open `/admin/signed-artifacts`. Verify a row appears with:
   - The reviewer's typed name + signed_at timestamp
   - A SHA-256 hex string (64 chars)
   - A download link to the sealed PDF
4. Download the PDF. Recompute SHA-256 locally
   (`openssl dgst -sha256 -hex placard.pdf`). It must match.
5. Generate a `/admin/compliance-bundle` covering the signoff window.
   Verify the cover sheet lists the same SHA-256 next to the equipment
   ID.

## B — Retention policy + legal holds

1. Open `/admin/retention`. The four record types should show their
   defaults (5y / 3y / 3y / 7y).
2. Change `incident_retention_days` to 60. Save. Reload — value
   persists.
3. Click **Place a legal hold**. Pick scope=`incident`, scope_id =
   any active incident's ID, reason = "audit demo". Verify the hold
   appears in the active-holds list.
4. The held incident's row on `/incidents` should now show a
   "Retain — legal hold" badge.
5. Release the hold (with a release note). Verify `released_at` +
   `released_by_user_id` populated and the badge disappears.

## C — Incident → CAPA → verification-of-effectiveness

1. Open any incident detail page. Scroll to the **CAPAs** section.
2. Click **Add CAPA**. Set description, hierarchy_level=`engineering`,
   assignee=yourself, due_date=tomorrow. Save.
3. Click **Mark in progress**. Status flips.
4. Click **Mark completed**. Verify `completed_at` and
   `completed_by_user_id` (you).
5. **Critical:** click **Mark verified-effective** *as yourself*.
   Expected: 403 "You cannot verify your own CAPA. A different user
   must mark verified-effective."
6. Sign out, sign back in as a different admin. Mark verified-
   effective. Add a verification note. Verify the CAPA flips to
   `verified` status with `verified_by_user_id` = new user.
7. Open `/admin/insights`. The **CAPA widget** should now show
   "1 verified" and drill-down should land on this incident.

## D — Hierarchy of controls on near-miss escalation

1. Open `/near-miss/<id>` for any near-miss.
2. Click **Escalate to risk**. The modal should now require:
   - Risk description (pre-filled)
   - **At least one initial mitigating control** with a `hierarchy_level`
3. Try to save with no control → blocked.
4. Try to save with a control but no hierarchy_level → blocked.
5. Save with eliminate-level control → risk row created in `risks`,
   `near_misses.linked_risk_id` AND `escalated_to_risk_id` both set.
6. Open `/risk/<new-risk-id>`. The **ControlsHierarchySummary**
   stacked bar should show one Eliminate control with
   "Top-of-hierarchy: Eliminate" callout.

## E — ISO 45001 clause-evidence map

1. Open `/admin/iso45001`. The clause-map table should list canonical
   ISO 45001:2018 clauses (8.1.2, 6.1.2.1, 7.2, 7.3, 9.1, 10.2 at
   minimum) with the modules that contribute.
2. Click into clause **8.1.2** → `/admin/iso45001/8.1.2`. Verify the
   evidence list shows incidents, near-miss reports, risks for the
   tenant.
3. Click **Export evidence pack**. A PDF downloads with the clause
   cover sheet + the rows.
4. Repeat for clause **10.2** — should show incident_capas with
   verification-of-effectiveness records.

## F — AI-assisted severity escalation prediction

1. Open an incident classified by the reporter as `first_aid` whose
   description suggests something more serious (e.g. "employee
   complained of dizziness after head impact, sent home, missed next
   day"). Pick or create one in a non-prod tenant.
2. Click **Run prediction**. Expected: a 1–3 second wait, then a
   banner appears:
   - Predicted severity (likely `lost_time` or `medical`)
   - Confidence (0–1)
   - Reasoning paragraph
   - If `shouldEscalate(current, prediction)` is true, the banner
     should be yellow with "Consider reclassifying" CTA.
3. The prediction MUST NOT auto-mutate `severity_actual`. Verify by
   refreshing — severity_actual unchanged.
4. Open `/admin/audit` filtered to `incident_predictions`. The
   invocation must appear with model=`claude-haiku-...` and the
   tenant_id matches.
5. **Rate limit test:** click Run prediction 31 times in an hour on
   the same incident. The 31st request should return 429 with a
   retry-after header.

## G — Cross-cutting checks

### Tenant isolation (CRITICAL — view security_invoker bug was caught in audit)

1. Log in as a user in **tenant A**. Open `/risk/<some-id>` and note
   the controls shown.
2. Log in as **tenant B** (different org). Try to query
   `risk_controls_hierarchy` directly via the Supabase JS client in
   the browser console:
   ```js
   const { data } = await supabase
     .from('risk_controls_hierarchy')
     .select('*')
   ```
   Expected: returns 0 rows or only tenant B's rows. If you see
   tenant A's controls, the security_invoker fix in migration 153
   didn't apply — escalate immediately.

### Audit log

3. Open `/admin/audit`. Filter by `incident_capas`, `legal_holds`,
   `loto_signed_pdf_artifacts`, `iso45001_clause_evidence`. Each
   recently-created row should appear with the correct actor.

### Search-path hardening

4. (DB level — informational.) Module 2 SECURITY DEFINER functions
   all set `search_path = pg_catalog, public, extensions`. This is
   the project standard and matches migration 124's hardening.
   Anything that DEFINER-runs as the function's owner uses this
   posture; no extra verification needed beyond the migration
   review.

---

## What's NOT covered by tests and needs manual verification

- **AI prediction quality** — the model's reasoning is advisory.
  Try several incidents with varied severities to feel out where
  Haiku helps and where it under-/over-predicts.
- **PDF rendering of the sealed artifact** — pdf-lib produces the
  PDF on the client; the sealed-artifact upload happens server-side
  via `lib/sealedArtifact.ts`. Verify the bytes-as-stored match the
  bytes-as-rendered by recomputing SHA-256 on a downloaded copy.
- **The retention purge cron** — Module 2 only classifies; the
  actual deletion job lives on a future roadmap. `/admin/retention`
  is read-only on the policy + holds; nothing in this module
  deletes data.
- **Vercel preview** — the Vercel deploy URL on the PR is a good
  place to drive C, D, E, F end-to-end without spinning up the
  local stack.
