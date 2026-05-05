# LOTO module — Lockout/Tagout

The LOTO module manages equipment-specific energy-isolation procedures
for industrial equipment, primarily food-production but applicable to
any general-industry workplace. The user starts on `/loto` (the
equipment dashboard).

## Regulatory references

LOTO procedures must satisfy both the federal floor and any
state-plan equivalent. For California sites, both apply.

- **Federal OSHA — 29 CFR 1910.147** ("The Control of Hazardous
  Energy / Lockout-Tagout") — the foundational federal standard.
  Covers servicing and maintenance of machines and equipment in
  which the unexpected energization, start-up, or release of stored
  energy could cause injury.
- **Federal OSHA — 29 CFR 1910.333** — selection and use of
  electrical work practices, including lockout/tagout for
  electrical equipment specifically.
- **Cal/OSHA — Title 8 §3314** ("Cleaning, Repairing, Servicing,
  Setting-Up, and Adjusting Operations of Machines or Equipment") —
  the California parallel. T8 §3314 is more prescriptive than the
  federal standard in some places — required minimum content for
  isolation procedures is spelled out subsection-by-subsection.
- **Cal/OSHA — Title 8 §2320.4** (electrical safety LOTO subset).
- **ANSI/ASSP Z244.1** — voluntary consensus standard that's often
  treated as best-practice guidance for "equivalent alternative
  methods" some OSHA standards reference.

The platform's energy-source codes (E electrical / G gas / H hydraulic
/ P pneumatic / O mechanical / OG compressed gas) map to the energy
types these standards enumerate. Each isolation step on a placard
captures the three things every standard expects: **identify the
energy source**, **isolate it physically**, **verify zero energy**.

## Key pages

- `/loto` — equipment list / dashboard with filters by department, status,
  and tag.
- `/equipment/[id]` — single equipment detail. Edit fields, upload photos,
  author energy-isolation steps, view the printable placard.
- `/departments` — list of departments with review status.
- `/departments/[dept]` — department detail with the Sign-Off workflow.
- `/print` — batch print queue. Flat list or grouped by department, with
  CSV export and merge-and-download.
- `/import` — bulk CSV import of equipment.
- `/decommission` — list and restore decommissioned equipment.
- `/status` — verification status by department (which placards have all
  fields + photos + isolation steps complete).

## Adding equipment

1. From `/loto`, tap **+ Add equipment**.
2. Fill in equipment ID, description, department, and notes (optional).
3. Save. You can now add photos and energy-isolation steps from the
   equipment detail page.

Bulk option: use `/import` to upload a CSV. Headers and column rules are
shown on the import page.

## Photos

- Each piece of equipment can have an **equipment photo** (general view)
  and an **isolation photo** (showing the lockout points / placard).
- Tap the photo placeholder to upload from camera or file. On iPad/iPhone
  you'll get the camera by default.
- Photos are AI-validated by Claude — you'll see a green check or a
  yellow warning if the image doesn't match the equipment.
- Photos are compressed in the browser before upload to keep them small.

**Why was my photo rejected?** Either the photo doesn't show the
equipment described, or the image is too dark / blurred to verify. Take
a clearer shot of the actual nameplate or the disconnect, and try again.

## Energy-isolation steps

The placard's compliance content. Each row is one independent energy
source.

1. On the equipment detail page, tap **+ Add step** under "Energy
   Isolation Procedures".
2. Choose the energy code (E electrical, G gas, H hydraulic, P pneumatic,
   O mechanical, OG compressed gas, N none — formal absence).
3. Fill in **Tag description** (specific device + location), **Isolation
   procedure** (physical action + lock point + stored-energy release), and
   **Verification method** (the concrete zero-energy test).

### AI draft assistant

On the steps panel, **Generate with AI** sends the description, photos,
and notes to Claude Sonnet, which proposes one step per energy source
following 29 CFR 1910.147 + Cal/OSHA T8 §3314 conventions (identify
source → isolate → verify zero energy). **A qualified safety
professional must review every generated step before signing the
placard.** The AI is a drafting tool, not the authority.

## Department sign-off

- Open `/departments/[dept]` for the department you want to sign off.
- The page shows every piece of equipment, photo status, and step
  completeness.
- Tap **Sign off** (only enabled when all required content is present)
  → review modal → signature pad → submit.
- The signed placard PDF is generated with `pdf-lib` (signature + auto-
  date stamped onto the placard) and stored in the `loto-photos` bucket.
- The department PDF (all signed placards merged) auto-downloads.

## Print queue

- `/print` lists everything ready to print. Flat by default; **Group by
  dept** toggles a grouped view.
- **Export CSV** for offline tracking. **Merge & download** produces a
  single PDF you can hand to a printer.

## Reviewing a department later

History is kept on the department detail page — every signed-off review
shows who signed, when, and a link to the merged PDF.

## Common questions

**"The Sign Off button is disabled."** One or more pieces of equipment
in the department is missing a photo or has zero energy-isolation steps.
The status column on the department page shows which.

**"Can I edit a placard after sign-off?"** Yes — editing the equipment
re-opens the placard for the next review cycle. Previous signed PDFs are
preserved for audit.

**"How do I decommission equipment?"** From the equipment detail page,
tap the menu and choose **Decommission**. It moves to `/decommission`
where it can be restored if needed.

**"I imported a CSV but nothing showed up."** Check `/import` for the
status. If validation failed, the page lists the row + reason. Fix the
CSV and re-upload — duplicate IDs are skipped, not duplicated.

**"My photos look rotated wrong on the placard."** Re-take the photo
holding the device in landscape orientation. The compression step
respects EXIF rotation but some older devices write incorrect EXIF.

## When to escalate to human support

- Anything where you're being asked **is this LOTO procedure compliant**
  for a specific machine — the bot cannot make that determination, only
  a qualified person can.
- Suspected data loss or RLS issues (you're seeing data from another
  tenant or you can't see your own).
- Anything involving signed PDFs that need to be re-issued for an audit.
