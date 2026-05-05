# Hot Work module

The Hot Work module manages welding, cutting, grinding, and other
spark-producing work permits under OSHA 1910.252, Cal/OSHA Title 8
§6777, and NFPA 51B. The user starts on `/hot-work`.

## Key pages

- `/hot-work` — permit list. Default view shows **open** permits
  (pending signature, active, in post-watch, or expired-uncancelled).
  Headline tiles count each state. Searchable by serial, location,
  description, or person.
- `/hot-work/new` — issue a new permit (lands in **pending signature**).
- `/hot-work/[permitId]` — the live permit: PAI sign-on, work timer,
  fire-watch sign-on, close-out.
- `/hot-work/status` — big-screen monitor board for a control room or
  site office. Dark theme, large fonts, auto-refresh every 30 seconds.

## Issuing a permit

1. From `/hot-work`, tap **+ New permit**.
2. Fill **scope**: location, work description, work types (welding,
   cutting, grinding, brazing, etc.), duration (default 4 hours, max 8),
   post-work fire-watch minutes (NFPA 51B §8.7 floor is 60 minutes;
   many sites use 120).
3. List **hot-work operators** and **fire-watch personnel**. Per
   Cal/OSHA §6777, the fire watch must be a separate person from the
   operator.
4. Complete the **pre-work checklist** (FM Global 7-40 / Cal/OSHA
   §§4848-4853): combustibles cleared 35 ft, floor swept, openings
   protected, sprinklers operational (or alternate fire protection
   documented), ventilation adequate, fire extinguisher present (note
   the type), curtains/shields in place, adjacent areas notified, gas
   lines isolated (N/A allowed when there are none), confined-space
   flag, elevated-work flag.
5. If the work is **inside a confined space**, link the active
   confined-space permit per §1910.146(f)(15) — the form will block
   sign-off without it.
6. Optionally link equipment under LOTO, work-order reference, and
   notes.
7. Save as **pending signature**.

## PAI sign-off (Permit Authorizing Individual)

The PAI reviews the permit before activating it. Sign-off is blocked
until:

- Every required pre-work checklist item is confirmed (or marked N/A
  where allowed).
- Operators and fire-watch personnel have current OSHA 1910.252
  training records, OR the PAI has explicitly verified offline and
  ticked the override.
- A confined-space link exists if the checklist flags confined-space
  work.

Tap **Sign to authorize** → signature pad → submits. The permit
becomes **active** and the countdown timer starts.

## During work

- The live permit shows the **work countdown**. You can extend or
  cancel at any time.
- When the operator finishes, tap **Mark work complete**. The status
  flips to **post-work fire watch** and the post-watch timer starts.

## Fire watch

NFPA 51B §8.7 requires a continuous post-work fire watch. Once work
is marked complete:

1. The fire watcher signs on — name + timestamp recorded.
2. The post-watch countdown runs to zero. **The permit cannot close
   early** even if the watcher reports all-clear.
3. When the timer hits zero, the permit is **ready to close**.
4. PAI (or another authorized closer) closes the permit with **task
   complete**.

## Cancelling for cause

At any point — pending, active, or in post-watch — you can close the
permit **for cause** if a fire is observed or any unsafe condition
occurs. Choose the reason and add notes. The audit log records the
cancellation.

## The status board

`/hot-work/status` is built for a wall-mounted screen in a control
room. It shows:

- Headline tiles: permits active, expiring within 30 minutes, in
  post-watch, **needs action** (red panel listing expired-uncancelled
  and watch-complete permits that someone needs to close).
- Grid of active and post-watch cards with live countdown timers,
  personnel rosters, and operator/watcher names.
- A **stale-data banner** if the auto-refresh is more than 60 seconds
  late.

## Common questions

**"The Sign button is disabled."** A pre-work checklist item is
unchecked, a training record is missing, or a required confined-space
permit link is missing. The form lists the specific blockers.

**"How do I extend a permit that's about to expire?"** From the live
permit, tap **Extend** → enter additional minutes → confirm. The
extension is logged in the audit trail.

**"The fire watcher hasn't signed on but work is done."** The permit
will sit in **post-work fire watch** with no countdown until someone
signs on as the watcher. The board flags this in **Needs action**.

**"How do I close a permit after the post-watch timer ran out?"** From
the live permit, tap **Close — task complete**. If the timer is still
running, you'll see a disabled button with the time remaining.

**"How do I link a confined-space permit?"** On the new-permit form,
under **Concurrent permits**, search for the active confined-space
permit by serial or space ID. Both sides must reference each other.

## When to escalate to human support

- **Active fire** or any actual fire-watch event in progress —
  call site emergency first, then escalate the documentation to
  support.
- **Checklist items the user can't complete safely** (e.g. sprinklers
  offline with no alternate documented) — a qualified person decides
  whether work proceeds.
- **Training records cannot be located** for an operator or fire
  watcher — escalate to the training admin so the override is
  defensible at audit.
- Anything involving permits that need to be re-issued or amended for
  audit purposes.
