# Risk module

The Risk module is the hazard identification and risk evaluation
register, aligned to ISO 45001 §6.1 and OSHA / Cal/OSHA recordkeeping
+ IIPP requirements. The user starts on `/risk` (the heat map).

## Regulatory references

The risk register isn't the subject of a single OSHA standard — it's
the documentation surface that satisfies multiple overlapping
requirements. The major ones the platform aligns to:

- **ISO 45001:2018 §6.1** ("Actions to address risks and
  opportunities") — the international occupational health-and-safety
  management system standard. §6.1.2 covers hazard identification +
  risk evaluation; §6.1.2.1 specifically requires the org to identify
  hazards on an ongoing and proactive basis. The risk register is
  the primary evidence artifact.
- **ISO 45001:2018 §8.1.2** ("Eliminating hazards and reducing OH&S
  risks") — the Hierarchy of Controls (elimination → substitution →
  engineering → administrative → PPE). The wizard's Controls step
  enforces this preference order.
- **OSHA General Duty Clause — Section 5(a)(1) of the OSH Act of
  1970** — employers must provide a workplace "free from recognized
  hazards that are causing or are likely to cause death or serious
  physical harm." The risk register is the proactive identification
  of those recognized hazards.
- **Cal/OSHA — Title 8 §3203** (the IIPP — Injury and Illness
  Prevention Program) — the cornerstone of California's general-
  industry safety program. §3203(a)(4) specifically requires
  procedures to identify and evaluate workplace hazards. The IIPP
  printable export at `/risk/export/iipp` is formatted for state
  inspectors who expect this layout.
- **OSHA Recommended Practices for Safety and Health Programs (2016)**
  — federal guidance that mirrors Cal/OSHA's IIPP requirements. Used
  by safety-program auditors at federal-OSHA-only sites.
- **OSHA PPE — 29 CFR 1910.132(d)** — requires a workplace hazard
  assessment to determine PPE requirements. The risk register's
  PPE-only justification field captures the documentation §1910.132(d)
  demands when PPE is the controlling measure for a high-severity
  hazard.
- **OSHA — 29 CFR 1910 Subpart I** (PPE), **Subpart Z** (toxic and
  hazardous substances), **Subpart S** (electrical) — the
  hazard-specific federal standards risks may need to reference.
- **ANSI/ASSP Z10** — voluntary consensus standard for
  occupational health-and-safety management; ISO 45001's predecessor
  in the U.S. context.

The PPE-alone rule in the wizard (residual score ≥ 8 with PPE-only
controls requires written justification) is enforced at the database
trigger level (migration 039) and traces to ISO 45001 §8.1.2 + OSHA
§1910.132(d). The justification is what an auditor will read when
asking "why isn't there a higher-tier control?"

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
