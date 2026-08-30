# Smoke test — Operator Console approval engine + carve-outs

Covers the regulated-action work shipped this session (v1.10.0–v1.11.0): the
approval engine, the approver inbox, and all six carve-outs. Drive these against
a real browser on a tenant where migrations **237/238/239** are applied (Soteria
Main Project) with at least one **owner**, one **admin**, and one **member**
account. The unit suite (149 operator tests) covers the logic with mocked
Supabase; this checklist covers the things tests can't — the browser UI, real
role gating, and the live external paths.

## A. Approver inbox (`/operator/approvals`)
1. As an **admin/owner**, open `/operator` → click **Approvals**. Confirm a plain
   **member** does NOT see the Approvals link.
2. Empty state: with nothing staged, the inbox shows "Nothing is awaiting
   approval." — not an error.
3. **Load-error surfacing** (this audit's fix): force the read to fail (e.g. point
   at a bad env / revoke the grant) and reload. The page must show "Could not load
   the approval queue. Please retry." and **never** a false-empty inbox. Restore.

## B. Hot-work authorization (member stages → admin approves)
1. As a **member**, in `/operator` chat: "authorize hot-work permit <permit_id>".
   The agent should reply it is **staged for approval** (not done), naming the serial.
2. As an **admin**, open `/operator/approvals` → the item is under "Awaiting
   approval". Click **Approve & apply**.
3. Verify the permit is now signed (`pai_signature_at` set; the approver is the PAI).
4. Under **Recent**, the item shows "applied" → click **Roll back** → the permit is
   unsigned again and Recent shows "rolled back".
5. Reject path: stage another, click **Reject**, enter a reason → moves to Recent as
   "rejected" with the reason.

## C. Confined-space entry (same shape as hot-work)
- Repeat B for "authorize confined-space entry <permit_id>". Confirm the approver
  becomes the entry supervisor; rollback un-signs.
- Edge: if an atmospheric test auto-canceled the permit, approval must fail cleanly
  ("canceled … cannot be authorized").

## D. CAPA high-severity close (admin)
- On a **complete** corrective action whose parent incident is
  lost_time/fatality/catastrophic: stage "close CAPA <action_id>". Approve as an
  admin who is **not** the completer → moves to verified.
- Separation-of-duty: approving as the **completer** must fail ("verifier must
  differ from the person who completed the action").
- A non-high-severity action → stage must refuse.

## E. LOTO zero-energy cert (admin)
- Stage "certify zero-energy for equipment <equipment_id>". Approve → a row lands
  in `loto_zero_energy_certifications` with the approver as certifier.
- Stage the SAME equipment again while active → must refuse (one active cert).
- Roll back the applied cert → soft-revoked (`revoked_at` set); equipment can be
  re-certified afterward.

## F. OSHA 300A cert (admin stages, OWNER approves)
- As an **admin**, stage "certify the 300A for <establishment> <year>". As an
  **admin (non-owner)** try to approve → must be refused (owner required). As
  **owner** → approve; the 300A shows certified. Roll back → uncertified.

## G. OSHA ITA submit (admin stages, OWNER approves, IRREVERSIBLE) — care
- Only on a **certified, not-yet-submitted** 300A. Stage "submit 300A to OSHA for
  <establishment> <year>".
- With `OSHA_ITA_BASE_URL` **unset** (current prod state): approving must FAIL with
  "OSHA ITA submission is not configured…", and the 300A must remain **not
  submitted** (no phantom success).
- Recent shows **no Roll back** button for this action (irreversible).
- ⚠️ Do NOT exercise the live-submission path against the real OSHA ITA portal
  unless you intend an actual federal submission — use OSHA's test endpoint.

## Not coverable in the audit sandbox (run on a non-prod DB / real browser)
- Firing the DB CHECK constraints + the `loto_zero_energy_certifications`
  partial-unique index with real INSERTs. They are verified **present** (read-only)
  on prod; exercise on staging to confirm they reject illegal states (e.g. a second
  active cert per equipment, a `rolled_back` row that wasn't reversible).
- The approver inbox in a real browser (no browser in the audit sandbox).
