import { describe, it, expect } from 'vitest'
import { namesCurrentlyInside, validateRosterUpdate, rosterDiff } from '@/lib/permitRoster'
import type { ConfinedSpaceEntry } from '@/lib/types'

function entry(partial: Partial<ConfinedSpaceEntry>): ConfinedSpaceEntry {
  return {
    id:           'e-1',
    permit_id:    'p-1',
    entrant_name: 'Maria',
    entered_at:   '2026-04-26T12:00:00Z',
    exited_at:    null,
    entered_by:   'u-1',
    exited_by:    null,
    notes:        null,
    created_at:   '2026-04-26T12:00:00Z',
    ...partial,
  }
}

// ── namesCurrentlyInside ─────────────────────────────────────────────────

describe('namesCurrentlyInside', () => {
  it('returns an empty list when no entries exist', () => {
    expect(namesCurrentlyInside([])).toEqual([])
  })

  it('returns names from open entries (exited_at == null)', () => {
    expect(namesCurrentlyInside([
      entry({ id: '1', entrant_name: 'Maria', exited_at: null }),
      entry({ id: '2', entrant_name: 'Jose',  exited_at: '2026-04-26T13:00:00Z' }),
    ])).toEqual(['Maria'])
  })

  it('returns multiple names when several entrants are inside', () => {
    expect(namesCurrentlyInside([
      entry({ id: '1', entrant_name: 'Maria', exited_at: null }),
      entry({ id: '2', entrant_name: 'Jose',  exited_at: null }),
    ])).toEqual(['Maria', 'Jose'])
  })

  it('reports a name twice if the entrant has two open rows (data anomaly)', () => {
    // Schema's partial unique index prevents this in practice, but the
    // helper itself shouldn't dedupe — that would hide the anomaly.
    expect(namesCurrentlyInside([
      entry({ id: '1', entrant_name: 'Maria', exited_at: null }),
      entry({ id: '2', entrant_name: 'Maria', exited_at: null }),
    ])).toEqual(['Maria', 'Maria'])
  })
})

// ── validateRosterUpdate ─────────────────────────────────────────────────

describe('validateRosterUpdate', () => {
  it('allows a clean add of an entrant', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Maria', 'Jose'],
      nextAttendants: ['Tomás'],
      entries:        [],
      signedAttendantName: null,
    })
    expect(errs).toEqual([])
  })

  it('rejects blank names in either list', () => {
    expect(validateRosterUpdate({
      nextEntrants:   ['Maria', ''],
      nextAttendants: ['Tomás'],
      entries:        [],
      signedAttendantName: null,
    })).toContain('Names cannot be blank.')
    expect(validateRosterUpdate({
      nextEntrants:   ['Maria'],
      nextAttendants: ['  '],   // whitespace-only
      entries:        [],
      signedAttendantName: null,
    })).toContain('Names cannot be blank.')
  })

  it('rejects duplicate entrants (case-insensitive)', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Maria', 'maria'],
      nextAttendants: ['Tomás'],
      entries:        [],
      signedAttendantName: null,
    })
    expect(errs).toContain('Duplicate entrants on the roster.')
  })

  it('rejects duplicate attendants', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Maria'],
      nextAttendants: ['Tomás', 'Tomás'],
      entries:        [],
      signedAttendantName: null,
    })
    expect(errs).toContain('Duplicate attendants on the roster.')
  })

  it('blocks removal of an entrant who is currently inside the space', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Jose'],   // Maria removed
      nextAttendants: ['Tomás'],
      entries:        [entry({ entrant_name: 'Maria', exited_at: null })],
      signedAttendantName: null,
    })
    expect(errs.some(e => e.includes('Maria') && e.includes('inside'))).toBe(true)
  })

  it('allows removing an entrant who has already exited', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Jose'],   // Maria removed
      nextAttendants: ['Tomás'],
      entries:        [entry({
        entrant_name: 'Maria',
        exited_at:    '2026-04-26T13:00:00Z',
      })],
      signedAttendantName: null,
    })
    expect(errs).toEqual([])
  })

  it('warns (does not block) when removing the attendant who signed on', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Maria'],
      nextAttendants: ['Other'],   // Tomás removed; he was the signer
      entries:        [],
      signedAttendantName: 'Tomás',
    })
    // Warning string included, but the caller decides whether to block.
    expect(errs.some(e => e.toLowerCase().includes('heads up') && e.includes('Tomás'))).toBe(true)
  })

  it('does not warn when the signed attendant remains on the roster', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Maria'],
      nextAttendants: ['Tomás', 'Other'],
      entries:        [],
      signedAttendantName: 'Tomás',
    })
    expect(errs).toEqual([])
  })

  it('combines multiple validation failures', () => {
    const errs = validateRosterUpdate({
      nextEntrants:   ['Jose', ''],     // blank name + Maria removed
      nextAttendants: ['Tomás'],
      entries:        [entry({ entrant_name: 'Maria', exited_at: null })],
      signedAttendantName: null,
    })
    expect(errs.length).toBeGreaterThanOrEqual(2)
  })

  it('treats whitespace-only entrant as blank, not removed (validation order matters)', () => {
    // If a user types a space and Maria is inside, both blank and
    // still-inside should surface — the user fixes both before saving.
    const errs = validateRosterUpdate({
      nextEntrants:   ['Maria', '   '],
      nextAttendants: ['Tomás'],
      entries:        [entry({ entrant_name: 'Maria', exited_at: null })],
      signedAttendantName: null,
    })
    expect(errs).toContain('Names cannot be blank.')
  })
})

// ── rosterDiff ────────────────────────────────────────────────────────────

describe('rosterDiff', () => {
  it('detects entrants added and removed', () => {
    const out = rosterDiff(
      { entrants: ['Maria', 'Jose'], attendants: ['Tomás'] },
      { entrants: ['Maria', 'Ana'],  attendants: ['Tomás'] },
    )
    expect(out.entrantsAdded).toEqual(['Ana'])
    expect(out.entrantsRemoved).toEqual(['Jose'])
    expect(out.attendantsAdded).toEqual([])
    expect(out.attendantsRemoved).toEqual([])
  })

  it('detects attendant changes independently', () => {
    const out = rosterDiff(
      { entrants: ['Maria'], attendants: ['Tomás'] },
      { entrants: ['Maria'], attendants: ['Other'] },
    )
    expect(out.attendantsAdded).toEqual(['Other'])
    expect(out.attendantsRemoved).toEqual(['Tomás'])
  })

  it('returns all-empty arrays for an unchanged roster', () => {
    const list = { entrants: ['Maria'], attendants: ['Tomás'] }
    expect(rosterDiff(list, list)).toEqual({
      entrantsAdded: [], entrantsRemoved: [], attendantsAdded: [], attendantsRemoved: [],
    })
  })

  it('case-sensitive — different case counts as a change', () => {
    // Up to the validation layer to decide if that's actually OK; the
    // diff helper just reports literal differences.
    const out = rosterDiff(
      { entrants: ['Maria'], attendants: [] },
      { entrants: ['maria'], attendants: [] },
    )
    expect(out.entrantsAdded).toEqual(['maria'])
    expect(out.entrantsRemoved).toEqual(['Maria'])
  })
})
