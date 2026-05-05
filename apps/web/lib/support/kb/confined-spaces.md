# Confined Spaces module

The Confined Spaces module manages permit-required confined-space
inventory and entry permits. The user starts on `/confined-spaces`.

## Regulatory references

Confined-space entry is heavily regulated. Both federal and state-plan
standards apply for California sites; pure federal-OSHA sites need
only the federal column.

- **Federal OSHA — 29 CFR 1910.146** ("Permit-Required Confined
  Spaces") — the foundational federal standard. The 15 fields the
  permit form walks you through map to the elements 1910.146(f)
  enumerates.
- **Federal OSHA — 29 CFR 1910.146(d)(14)** — requires retention of
  cancelled permits for at least 1 year for the annual program
  review. The platform retains them indefinitely (audit log is
  append-only) so this is satisfied automatically.
- **Federal OSHA — 29 CFR 1910.146(e)(5)(ii)** — the "prohibited
  condition" rule that forces evacuation when atmospheric readings
  go out of acceptable range. The platform's auto-cancel-on-
  prohibited-condition flow implements this directly.
- **Federal OSHA — 29 CFR 1910.146(f)(15)** — requires concurrent
  hot-work permits to be cross-referenced when hot work occurs
  inside a permit-required space.
- **Cal/OSHA — Title 8 §5157** ("Permit-Required Confined Spaces")
  — the California parallel to 1910.146. Substantively similar; the
  platform's form fields satisfy both.
- **Cal/OSHA — Title 8 §5158** ("Other Confined Space Operations")
  — covers non-permit confined spaces and reclassified spaces.
  Relevant when a space's classification toggle changes.
- **Cal/OSHA — Title 8 §5156** — definitions and scope.
- **Federal OSHA — 29 CFR 1910.134** — respiratory-protection
  standard, applicable when atmospheric controls require respirators
  rather than ventilation alone.
- **ANSI Z117.1** — voluntary consensus standard on safety
  requirements for confined spaces; often treated as best-practice
  guidance.

The default acceptable atmospheric thresholds (O₂ 19.5–23.5%,
LEL <10%, H₂S <10 ppm, CO <35 ppm) are the standard floor for both
federal and California. Site-specific overrides are supported but
should be backed by industrial-hygiene data.

## Key pages

- `/confined-spaces` — inventory list, filterable by department; shows
  classification (permit-required, non-permit, reclassified), space type
  (tank, silo, vessel, hopper, etc.), and known hazards.
- `/confined-spaces/[id]` — single space detail. Profile, dimensions,
  hazards, atmospheric thresholds, isolation procedures, photos,
  recent permits.
- `/confined-spaces/[id]/permits/new` — issue a new entry permit (lands
  in **pending signature** state).
- `/confined-spaces/[id]/permits/[permitId]` — the live permit during
  entry: pre-entry test, supervisor sign-off, periodic monitoring,
  cancellation.
- `/confined-spaces/import` — bulk CSV import of spaces.
- `/confined-spaces/status` — board-style overview of active permits and
  open issues.

## Adding a confined space

1. From `/confined-spaces`, tap **+ Add space**.
2. Fill space ID, description, classification (permit-required vs.
   non-permit), space type, department, dimensions, and known hazards.
3. Set **acceptable atmospheric conditions** (defaults: O₂ 19.5–23.5%,
   LEL <10%, H₂S <10 ppm, CO <35 ppm — only override when you have
   site-specific data).
4. Save. From the detail page you can upload exterior + interior photos
   and write the isolation procedures.

## Issuing an entry permit

1. From `/confined-spaces/[id]`, tap **Issue permit**.
2. Fill the OSHA-required 15 fields (the form walks you through them):
   purpose, duration (max 8 hours), authorized entrants, attendants,
   entry supervisor, identified hazards, isolation/control measures,
   acceptable conditions, rescue service contact, communication method,
   equipment list, concurrent permits.
3. **Hot-work concurrent permit**: if work inside the space is hot-work,
   link the active hot-work permit here (and vice-versa from the hot-
   work side).
4. Save as **pending signature**.

### AI hazard / isolation suggestions

On the new-permit form, **Suggest hazards with AI** uses the space
description, photos, and any context you supply (e.g. "recently CIP'd,
caustic residual possible") to propose additional hazards, isolation
measures, atmospheric overrides, rescue equipment, and notes. The
suggestions are appended to the form for you to review — never accepted
automatically. **A qualified entry supervisor must verify every
suggestion before signing.**

## Pre-entry atmospheric test

On the live permit:

1. Go to **Atmospheric tests** → **Pre-entry test**.
2. Enter the tester ID, instrument ID, and readings (O₂, LEL, H₂S, CO).
3. The form turns green if all four readings are within the space's
   acceptable conditions, red if any is out of range.
4. **You cannot sign the permit until the pre-entry test passes.**

## Sign-off and entry

The entry supervisor signs the permit to authorize entry. Sign-off
checks:

- Pre-entry atmospheric test passed.
- Authorized entrants and attendants are named.
- Training records are current for everyone listed (or the supervisor
  has explicitly overridden after verifying offline).
- Rescue service has a name AND either a phone number (outside service)
  or ETA (in-house team).
- Any concurrent hot-work permit is linked.

If any of these are missing, the **Sign** button stays disabled and the
form shows what to fix.

## Periodic atmospheric tests during work

The attendant logs periodic tests on the live permit. If any reading
fails the acceptable thresholds:

1. A **red banner** appears across the top of the page.
2. The permit auto-cancels per §1910.146(e)(5)(ii) — entrants must
   evacuate immediately.
3. The cancellation reason is recorded as **prohibited condition**.

## Cancelling a permit

When work ends, the supervisor cancels the permit with a reason:

- **Task complete** — normal close-out.
- **Prohibited condition** — atmospheric or other hazard.
- **Expired** — duration ran out before the work finished; issue a new
  permit if work continues.

Cancelled permits are retained for at least one year per §1910.146(d)(14)
for the annual program review.

## Decommissioning a space

From the space detail page, you can mark a space decommissioned (e.g.
removed from service). **You cannot decommission a space that has any
unsigned-and-not-cancelled permit on it** — entrants could still be
inside. Cancel those permits first.

## Common questions

**"The Sign button is disabled."** Pre-entry test hasn't passed, or
training records are missing for someone listed, or rescue service
contact is incomplete, or a confined-space + hot-work concurrent permit
isn't linked. The form shows the specific blocker.

**"How do I add concurrent hot work?"** Open the permit, go to the
**Concurrent permits** field, search for the active hot-work permit by
serial. Both sides must reference each other.

**"How do I cancel a permit before work starts?"** From the live permit
page, tap the menu → **Cancel permit** → choose **Task complete** if
you're aborting cleanly, or **Prohibited condition** if a hazard was
found.

**"Why did the permit auto-cancel?"** A periodic atmospheric reading
fell outside the acceptable range. The audit log on the permit shows
which reading and when.

## When to escalate to human support

- Anything where you're being asked **is this space classified
  correctly** for OSHA — a qualified safety professional must decide.
- **Atmospheric test fails or recurring failures** — get out of the
  space and call site safety. The bot cannot triage a live hazard.
- **Training records gap** that the supervisor cannot resolve offline
  — escalate to the training admin.
- **Rescue service unreachable** during an active entry — call site
  emergency, then escalate.
- Anything involving signed permits that need re-issuing for an audit.
