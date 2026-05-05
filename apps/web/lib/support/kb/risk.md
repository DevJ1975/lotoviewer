# Risk module

The Risk module is the ISO 45001 §6.1 hazard identification and risk
evaluation register. The user starts on `/risk` (the heat map).

## Key pages

- `/risk` — 5×5 heat map (severity × likelihood). Each cell shows a
  count; click to drill into the risks at that band. Filter by status
  (open, mitigated, accepted), hazard category, or view mode (inherent
  vs. residual). Top-5 list of highest residual risks at the bottom.
- `/risk/list` — table view of every risk with the same filters,
  free-text search, sort by score / next-review-date / created-at, and
  pagination.
- `/risk/new` — multi-step wizard to create a new risk.
- `/risk/[id]` — single-risk detail. Side-by-side inherent and residual
  scores, controls table, review history, append-only audit timeline.
- `/risk/controls` — tenant-scoped Controls Library that the wizard
  pulls from.
- `/risk/export/iipp` — Cal/OSHA IIPP printable export.

## Creating a new risk

The wizard at `/risk/new` walks you through five steps:

1. **Identify** — hazard category (physical, chemical, biological,
   ergonomic, psychosocial, …), short description, location, activity
   type, exposure frequency, source.
2. **Inherent score** — severity (1–5) × likelihood (1–5) **without**
   any controls. The product is the inherent score.
3. **Controls** — pick from the **Hierarchy of Controls** in OSHA
   preference order: elimination, substitution, engineering,
   administrative, PPE. Suggested controls are filtered from your
   tenant's Controls Library by the hazard category. You can also add
   free-text controls for one-off cases.
4. **Residual score** — re-score severity × likelihood **with controls
   in place**. The wizard flags if the residual is still above the
   site's acceptance threshold.
5. **Assign** — owner, reviewer, approver, and a **next review date**
   (typically annual per ISO 45001).

## Heat map and drill-down

The heat map's color bands match common safety-sector convention:
green/low, yellow/moderate, orange/high, red/extreme. Click any cell
to see only the risks at that score, then click a row to open the
detail page.

Toggle **Inherent** vs. **Residual** at the top to see which risks
your controls actually moved off the red band.

## Risk detail

The `/risk/[id]` page is read-mostly. It shows:

- The risk number and title.
- Side-by-side **inherent** and **residual** score cards with the
  severity × likelihood grid and color band.
- All risk metadata: category, source, activity type, location, owner,
  reviewer, approver, next review date, full description.
- The **controls** table (hierarchy level, name, effectiveness
  assessment).
- **Review history** — every formal sign-off.
- **Audit timeline** — append-only log of every change (status, score,
  controls, owner). This is what auditors look at.

Admins get **Edit**, status change (open → mitigated → accepted), and
reassign actions on this page.

## Controls Library

`/risk/controls` is the catalog of available controls for your tenant.

- **Active** controls show in the wizard's suggestion panel.
- **Inactive** controls are kept for audit but no longer offered.
- Add custom controls (name, description, hierarchy tier, regulatory
  reference, applicable hazard categories).
- You can deactivate a control even if existing risks reference it —
  the audit trail is preserved.
- You **cannot hard-delete** a control that is in use; deactivate it
  instead.

## Exports

- **`/risk/export/iipp`** produces the Cal/OSHA Injury and Illness
  Prevention Plan layout for state inspectors.
- **JSON export** (button on `/risk`) produces an ISO 45001 audit
  bundle for external safety audits.

## Common questions

**"How do I score a risk that has never had an incident?"** Use
likelihood **1 (rare)** and a severity rating based on what *could*
happen if controls failed. The point of inherent scoring is the
worst-case-without-controls scenario, regardless of past history.

**"My residual score is still red. What now?"** The wizard flags it.
You have two paths: (a) add additional controls higher in the
Hierarchy and re-score, or (b) escalate to a qualified safety
professional who can either add controls or formally accept the
elevated risk with documented justification + approver signature.

**"Why can't I select PPE-only controls?"** You can — the wizard
won't block you — but if PPE is the *only* control type, the residual
flag will require justification explaining why elimination,
substitution, engineering, or administrative controls are infeasible.
PPE-only is a defensible control set, but it must be *justified*.

**"How do I find risks that are overdue for review?"** Sort
`/risk/list` by **Next review date**. Anything past today's date is
overdue.

**"Can I edit a risk after it's been signed off?"** Yes, but every
edit appends to the audit timeline. Score or control changes will
also reset the next-review-date to flag the change for re-approval.

**"How do controls roll up to the Cal/OSHA IIPP export?"** The IIPP
export groups risks by hazard category, lists controls in Hierarchy
order, and includes the next review date — the format Cal/OSHA
inspectors typically expect.

## When to escalate to human support

- **Residual score above the site's acceptance threshold** that you
  can't bring down with additional controls — only a qualified safety
  professional can formally accept an elevated risk, with documented
  justification and the approver signature.
- **Control-effectiveness disagreement** — the bot can't tell you
  whether a specific control will actually reduce a risk in your
  facility. That's an evaluator's call.
- **Annual review sign-off** — per ISO 45001, a human reviewer must
  decide if scores or controls need updating; the bot can flag
  overdue reviews but not perform them.
- **PPE-only justification** for higher-tier-feasible scenarios — a
  qualified person must write the justification.
- Anything involving a risk that needs to be re-opened or amended
  after a formal close-out.
