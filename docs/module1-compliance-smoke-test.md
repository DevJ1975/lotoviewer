# Module 1 — LOTO Compliance Core Smoke Test

Goal: verify the seven feature subareas (§147(c)(4)(ii), (c)(6), (c)(7),
(f)(2), (f)(3), (f)(4), (g)(2)) work end-to-end on a real browser before
running Module 2. Run as a tenant admin in a non-production environment.

## A — Structured procedure phases (§147(c)(4)(ii))

1. Open `/equipment/<id>` for a piece of equipment that already has
   energy steps.
2. Click "Edit steps".
3. For each step, verify the **phase dropdown** offers: shutdown,
   isolate, release stored energy, lockout, verify zero energy.
4. Delete the `verify_zero_energy` step and click Generate placard.
   Expected: the placard generator **refuses** with a banner explaining
   the missing phase.
5. Add the step back, save, regenerate — placard renders cleanly with
   the structured phases visible.

## B — Annual periodic inspection (§147(c)(6))

1. Open `/admin/periodic-inspections`. Confirm the four cohorts render
   (overdue / due-soon / never / current).
2. From the list, click into one equipment row → goes to
   `/equipment/<id>/periodic-inspection`.
3. Fill the form: inspector name, observed workers (multi-select from
   the worker roster), per-step deviations, corrective actions, e-sig.
4. Save unsigned. Expected: row appears under "Draft" — can be reopened.
5. Re-open and sign. Expected: row freezes, `next_periodic_review_due_at`
   on the equipment becomes (now + 365 days), equipment moves from
   `overdue` → `current` cohort on the list page.
6. Open `/loto` and `/status` — verify the **PeriodicInspectionWidget**
   renders the overdue count (or hides itself when zero).

## C — Retraining triggers (§147(g)(2))

1. Sign a periodic inspection (step B5) **with deviations filled in**
   AND at least one observed worker.
2. Open `/admin/training-records`. Verify the new **retraining
   attention panel** shows that worker with a "deviation observed"
   trigger.
3. Edit one of the equipment's energy steps. Expected: every currently-
   trained worker on that procedure gets a `procedure_change` trigger
   in the retraining panel.
4. In the retraining panel, click **Resolve with new training record**
   for a trigger → creates a fresh `loto_training_records` row, marks
   the trigger resolved.
5. Try **Mark resolved without retraining** — should require a note
   and stamp `resolved_at`.

## D — Group LOTO (§147(f)(3) / (f)(4))

1. Open `/loto/group-permits/new`. Set work description, primary
   authorized employee, attach two equipment IDs. Save.
2. On the detail page, **try to add a member before assigning a primary**
   on a fresh permit (or via the API) — expected to be blocked.
3. Add three members with distinct personal lock serials.
4. **Try to close** — expected to be blocked with "3 members still
   attached".
5. Mark two members as left (left_at set), try again. Expected:
   blocked with "1 member still attached".
6. **Handoff**: click "Hand off to new primary", pick a different user.
   Status flips to `shift_handed_off`. Try to hand off **to yourself** —
   expected to be blocked.
7. Mark the last member as left, close the permit. Verify it stamps
   `ended_at` and freezes the row.
8. After close: **try to add a member to a closed permit** — expected
   to be blocked at both the UI and the DB.

## E — Contractor companies (§147(f)(2))

1. Open `/admin/contractors`. Add a contractor: name, contact email,
   insurance expiry **30 days from today**.
2. Verify the digest helper would surface this contractor (set ASOF
   appropriately in a test, or wait — the digest is for the renewal
   email cron).
3. Edit the contractor: set host_procedures_acknowledged_at via the
   "Acknowledge host procedures" button. Verify the acknowledgement
   timestamp + user_id persist.
4. Deactivate the contractor → row hides from the active list.
5. Add a worker via `/admin/workers` and assign it to this contractor
   company. Verify the worker page shows the contractor link.

## F — Competency exams (§147(c)(7))

1. Open `/admin/competency-exams`. Click "New exam", title it
   "Authorized employee operator", role `operator`, passing_score 80.
2. In the editor, add 5 questions, each with 4 distinct choices.
3. Try to save a question with **only one choice** — blocked.
4. Try to save with **two identical choices (different whitespace)** —
   blocked ("Choices must be distinct.").
5. Try answer_index 99 — blocked.
6. Save the exam. From `/admin/workers`, pick a worker and click "Take
   exam" → goes to the proctored take page.
7. **Open the take URL in a second tab** to verify whether duplicate
   attempts are created. Documented as low-risk (proctored use case),
   but worth confirming the proctor UX.
8. Answer all questions correctly → score 100, passed. Verify the
   auto-create training record toggle (default on) inserts a
   `loto_training_records` row tied to the attempt.
9. Re-take with one wrong answer — score drops, `passed=false`.

## G — Walkdown checklist (§147(c)(6))

1. Open `/equipment/<id>/walkdown`. Default checklist shows the six
   required items.
2. For one item, set status=`fail` but **leave notes empty**. Try to
   sign → blocked with "fail items must have notes".
3. Fill in the notes, upload a photo (verify it lands in
   `loto-photos` bucket under the walkdown path).
4. Set every item to `pass`, sign with typed name → row saves with
   `signed=true`, `signed_at` stamped.
5. History list updates — newest walkdown at the top.

## H — Cross-cutting checks

- **Tenant isolation**: log in as a user in tenant A, open
  `/admin/periodic-inspections` — should see only tenant A equipment.
  Switch to tenant B in the tenant switcher — list refreshes.
- **Audit log**: open `/admin/audit`. Filter to `loto_periodic_inspections`
  and verify your signed inspection appears with the correct actor.
  Similarly for `loto_group_permits`, `loto_group_permit_members`,
  `loto_group_permit_handoffs`.
- **Superadmin bypass**: as a superadmin in a different tenant context,
  the RLS policies should allow reads (verify only on a non-prod tenant).
- **Decommission**: decommission a piece of equipment that has periodic
  inspections — the equipment falls out of the
  `/admin/periodic-inspections` list (the helper drops decommissioned
  rows), but the audit history is preserved.

## I — Mobile/responsive

The new pages were built with the same shadcn + Tailwind grid as the
rest of the admin tree. Spot-check on a tablet (iPad Safari) that:

- `/loto/group-permits/<id>` (the most info-dense page) doesn't
  overflow horizontally.
- `/equipment/<id>/periodic-inspection` form is usable one-handed.
- `/equipment/<id>/walkdown` photo upload works from a mobile camera
  via `<input type="file" accept="image/*" capture>`.

---

## What's NOT covered by tests and needs manual verification

- The DB triggers in migration 142 fire on `loto_energy_steps`
  mutations — vitest can't exercise plpgsql. Confirm by editing a step
  and checking that retraining triggers appear in `/admin/training-records`
  (Section C step 3).
- The `close_loto_group_permit` and `handoff_loto_group_permit` RPCs
  enforce invariants at the DB layer — also can't be unit-tested. The
  TS helpers in `lotoGroupPermit.ts` mirror the same rules; verify
  both layers reject the bad cases (D2, D4, D5, D6, D8).
- The placard refusal on missing `verify_zero_energy` (A4) is enforced
  in `assertProcedureValid` inside `lib/pdfPlacard.ts`. The vitest
  suite stubs this; manual verification on a real placard PDF is the
  only way to confirm the user sees the banner.
- Photo upload paths land in `loto-photos/<tenant_id>/walkdown/<...>`
  per the `walkdownPhotoPath` helper. Confirm the path actually
  populates (Storage bucket browser) after Section G3.
