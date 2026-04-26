import type { ConfinedSpaceEntry, ConfinedSpacePermit } from '@/lib/types'

// Pure helpers for editing the entrant/attendant rosters on an active
// permit. The validation pivots on §1910.146(i)(4): the attendant must
// always know who's currently inside the space — so removing an entrant
// who has an open entries row is a hard error. We compute the list of
// names currently inside, and validate proposed roster updates against
// it before persisting.

// Names of entrants currently inside (open entries — exited_at IS NULL).
// Case-sensitive match against permit.entrants[] since that's what the
// entries table stores.
export function namesCurrentlyInside(entries: ConfinedSpaceEntry[]): string[] {
  return entries
    .filter(e => e.exited_at == null)
    .map(e => e.entrant_name)
}

// Validate a proposed roster update against the current state. Returns
// either a list of human-readable errors (caller blocks the save and
// surfaces them) or an empty array when the update is safe.
//
// Rules:
//   1. Names must be non-empty after trim. Empty cells make audit-trail
//      noise and break the entries-name match.
//   2. Within each list, names must be unique (case-insensitive). Two
//      "Maria Lopez" rows would be ambiguous in the entries log.
//   3. An entrant currently inside must remain on the roster — they
//      can't be removed without first being logged out via the entries
//      UI. Otherwise the attendant would lose visibility on a worker
//      who's still in the space.
export function validateRosterUpdate({
  nextEntrants,
  nextAttendants,
  entries,
  signedAttendantName,
}: {
  nextEntrants:        string[]
  nextAttendants:      string[]
  entries:             ConfinedSpaceEntry[]
  // Name from permit.attendant_signature_name (if any). Removing this
  // attendant from the roster would orphan the signature — we surface
  // a warning, not a block, since the audit trail still shows who
  // signed on at the time.
  signedAttendantName: string | null
}): string[] {
  const errors: string[] = []

  for (const list of [nextEntrants, nextAttendants]) {
    if (list.some(n => !n.trim())) {
      errors.push('Names cannot be blank.')
      break  // one error per condition is enough
    }
  }

  if (hasDuplicate(nextEntrants))   errors.push('Duplicate entrants on the roster.')
  if (hasDuplicate(nextAttendants)) errors.push('Duplicate attendants on the roster.')

  const inside = new Set(namesCurrentlyInside(entries))
  const removedInsideEntrants = [...inside].filter(n => !nextEntrants.includes(n))
  if (removedInsideEntrants.length > 0) {
    errors.push(
      `Cannot remove ${removedInsideEntrants.join(', ')} — currently inside the space. Log them out first.`,
    )
  }

  // Attendant who signed on duty isn't blocking — the audit log retains
  // the original signature even if the name is later removed. But surface
  // it so the user knows. Returns as a "warning" via a distinct error
  // string the dialog can choose to confirm-through.
  if (signedAttendantName && !nextAttendants.includes(signedAttendantName)) {
    errors.push(
      `Heads up: the attendant who signed on (${signedAttendantName}) is being removed from the roster.`,
    )
  }

  return errors
}

function hasDuplicate(names: string[]): boolean {
  const seen = new Set<string>()
  for (const n of names) {
    const key = n.trim().toLowerCase()
    if (!key) continue
    if (seen.has(key)) return true
    seen.add(key)
  }
  return false
}

// Pull diff metadata for the audit-friendly note we attach to the permit
// row when persisting. Lets supervisors and inspectors see why the roster
// changed mid-job.
export function rosterDiff(
  prev: Pick<ConfinedSpacePermit, 'entrants' | 'attendants'>,
  next: { entrants: string[]; attendants: string[] },
): { entrantsAdded: string[]; entrantsRemoved: string[]; attendantsAdded: string[]; attendantsRemoved: string[] } {
  return {
    entrantsAdded:     diff(next.entrants,   prev.entrants),
    entrantsRemoved:   diff(prev.entrants,   next.entrants),
    attendantsAdded:   diff(next.attendants, prev.attendants),
    attendantsRemoved: diff(prev.attendants, next.attendants),
  }
}

function diff(a: string[], b: string[]): string[] {
  const set = new Set(b)
  return a.filter(n => !set.has(n))
}
