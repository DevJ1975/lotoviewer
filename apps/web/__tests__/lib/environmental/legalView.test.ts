import { describe, it, expect, vi, afterEach } from 'vitest'
import { libraryForState } from '@soteria/core/environmental/packs/index'
import type { LegalEntry } from '@/lib/environmental/client'
import {
  evaluationBody, filterEntries, hasActiveFilters, isTileActive, jurisdictionLabel, linkableUrl, NO_FILTERS, ownerName,
  programOf, reviewChip, siteLabel, sortEntries, summarize, SUMMARY_TILES, toggleTile, verifyNoteFor, type LegalFilters,
} from '@/lib/environmental/legalView'

// The library is real by default; the lookup tests below swap in a small one so
// they keep their force after the real notes are signed off and removed.
vi.mock('@soteria/core/environmental/packs/index', async importActual => {
  const actual = await importActual<typeof import('@soteria/core/environmental/packs/index')>()
  return { ...actual, libraryForState: vi.fn(actual.libraryForState) }
})

afterEach(() => { vi.mocked(libraryForState).mockReset() })

function entry(overrides: Partial<LegalEntry> = {}): LegalEntry {
  return {
    id: 'e-1', facility_id: null, title: 'Title', citation: 'Citation', jurisdiction: 'federal', authority: null,
    summary: null, applicability_note: null, source_url: null, effective_date: null, review_frequency: 'annual',
    last_reviewed_at: '2026-01-15T10:00:00Z', next_review_due: '2027-01-15', program: 'air', library_key: null,
    applicability: 'applicable', compliance_status: 'not_evaluated', last_evaluated_at: null, evaluation_note: null,
    evidence_path: null, owner_user_id: null, source: 'tenant', review: 'ok',
    ...overrides,
  }
}

const filters = (overrides: Partial<LegalFilters>): LegalFilters => ({ ...NO_FILTERS, ...overrides })
const titles = (entries: LegalEntry[]) => entries.map(e => e.title)

describe('reviewChip', () => {
  it('says so plainly when an entry has never been reviewed', () => {
    expect(reviewChip(entry({ review: 'never_reviewed', last_reviewed_at: null, next_review_due: null }))).toEqual({ text: 'Never reviewed', tone: 'warn' })
  })

  it('shows the date the next review falls due', () => {
    expect(reviewChip(entry({ review: 'ok', next_review_due: '2027-01-15' }))).toEqual({ text: 'Review due 2027-01-15', tone: 'good' })
    expect(reviewChip(entry({ review: 'due_soon', next_review_due: '2026-11-01' }))).toEqual({ text: 'Review due 2026-11-01', tone: 'warn' })
  })

  it('says since when a review is overdue', () => {
    expect(reviewChip(entry({ review: 'overdue', next_review_due: '2026-05-01' }))).toEqual({ text: 'Overdue since 2026-05-01', tone: 'bad' })
  })

  it('falls back to the last review when no next date was ever set, showing only the day of a timestamp', () => {
    expect(reviewChip(entry({ review: 'ok', next_review_due: null, last_reviewed_at: '2026-03-02T23:59:00Z' }))).toEqual({ text: 'Reviewed 2026-03-02', tone: 'good' })
  })
})

describe('labels', () => {
  it('names the federal layer and abbreviates a state to its code', () => {
    expect(jurisdictionLabel('federal')).toBe('Federal')
    expect(jurisdictionLabel('CA')).toBe('CA')
  })

  it('reads the program from a free-text column, and a custom entry may have none', () => {
    expect(programOf({ program: 'stormwater' })).toBe('stormwater')
    expect(programOf({ program: null })).toBeNull()
    expect(programOf({ program: 'something_else' })).toBeNull()
  })
})

describe('ownerName', () => {
  const names = new Map([['u-1', 'Ana Ruiz']])

  it('resolves a known owner to a name', () => {
    expect(ownerName('u-1', names)).toBe('Ana Ruiz')
  })

  it('shows "Assigned" for an owner it cannot resolve, never the id', () => {
    expect(ownerName('0b6f2c1e-1111-4222-8333-444455556666', names)).toBe('Assigned')
  })

  it('is null for an entry with no owner', () => {
    expect(ownerName(null, names)).toBeNull()
  })
})

describe('siteLabel', () => {
  const names = new Map([['f-1', 'Plant 1']])

  it('names the site, and "All sites" for a requirement that covers every site', () => {
    expect(siteLabel('f-1', names)).toBe('Plant 1')
    expect(siteLabel(null, names)).toBe('All sites')
  })

  it('never shows the id of a site it cannot name', () => {
    expect(siteLabel('f-gone', names)).toBe('Unknown site')
  })
})

describe('linkableUrl', () => {
  it('lets web addresses through', () => {
    expect(linkableUrl('https://www.ecfr.gov/current/title-40')).toBe('https://www.ecfr.gov/current/title-40')
    expect(linkableUrl('HTTP://example.com/a')).toBe('HTTP://example.com/a')
  })

  it('refuses anything that is not a web page, and a missing address', () => {
    expect(linkableUrl('javascript:alert(1)')).toBeNull()
    expect(linkableUrl('data:text/html,<script>1</script>')).toBeNull()
    expect(linkableUrl('//example.com')).toBeNull()
    expect(linkableUrl('https://exa mple.com')).toBeNull()
    expect(linkableUrl(null)).toBeNull()
  })
})

describe('filterEntries', () => {
  const stormwater = entry({ id: 'a', title: 'Stormwater permit', program: 'stormwater', compliance_status: 'compliant', applicability: 'applicable', review: 'ok' })
  const air = entry({ id: 'b', title: 'Air permit', program: 'air', compliance_status: 'attention', applicability: 'under_review', review: 'overdue' })
  const custom = entry({ id: 'c', title: 'Local noise rule', program: null, compliance_status: 'non_compliant', applicability: 'applicable', review: 'never_reviewed' })
  const all = [stormwater, air, custom]

  it('returns everything when nothing is selected', () => {
    expect(filterEntries(all, NO_FILTERS)).toEqual(all)
  })

  it('narrows by program, applicability, compliance and review state', () => {
    expect(titles(filterEntries(all, filters({ program: 'air' })))).toEqual(['Air permit'])
    expect(titles(filterEntries(all, filters({ applicability: 'under_review' })))).toEqual(['Air permit'])
    expect(titles(filterEntries(all, filters({ compliance: 'non_compliant' })))).toEqual(['Local noise rule'])
    expect(titles(filterEntries(all, filters({ review: 'overdue' })))).toEqual(['Air permit'])
    expect(titles(filterEntries(all, filters({ review: 'never_reviewed' })))).toEqual(['Local noise rule'])
  })

  it('requires every selected filter to match', () => {
    expect(filterEntries(all, filters({ applicability: 'applicable', compliance: 'attention' }))).toEqual([])
    expect(titles(filterEntries(all, filters({ applicability: 'applicable', review: 'ok' })))).toEqual(['Stormwater permit'])
  })

  it('does not call a requirement that does not apply "not evaluated": it is settled', () => {
    const notApplicable = entry({ id: 'd', title: 'Not for us', applicability: 'not_applicable', compliance_status: 'not_evaluated' })
    const unrated = entry({ id: 'e', title: 'Waiting', applicability: 'under_review', compliance_status: 'not_evaluated' })
    expect(titles(filterEntries([notApplicable, unrated], filters({ compliance: 'not_evaluated' })))).toEqual(['Waiting'])
    expect(titles(filterEntries([notApplicable, unrated], filters({ applicability: 'not_applicable' })))).toEqual(['Not for us'])
  })

  describe('search', () => {
    const wastewater = entry({
      id: 'w', title: 'Pretreatment standards', citation: '40 CFR Part 403',
      summary: 'Limits on what an industrial user may discharge to the sewer.',
    })

    it('matches the title, the citation and the summary, ignoring case', () => {
      expect(filterEntries([wastewater], filters({ search: 'PRETREATMENT' }))).toHaveLength(1)
      expect(filterEntries([wastewater], filters({ search: '40 cfr' }))).toHaveLength(1)
      expect(filterEntries([wastewater], filters({ search: 'sewer' }))).toHaveLength(1)
      expect(filterEntries([wastewater], filters({ search: 'manifest' }))).toHaveLength(0)
    })

    it('needs every word, in any order and from any of the three fields', () => {
      expect(filterEntries([wastewater], filters({ search: 'sewer pretreatment' }))).toHaveLength(1)
      expect(filterEntries([wastewater], filters({ search: 'pretreatment manifest' }))).toHaveLength(0)
    })

    it('copes with an entry that has no summary, and treats blank input as no search', () => {
      const bare = entry({ summary: null, title: 'Bare', citation: 'X' })
      expect(filterEntries([bare], filters({ search: 'bare' }))).toHaveLength(1)
      expect(filterEntries([bare], filters({ search: 'undefined' }))).toHaveLength(0)
      expect(filterEntries([bare], filters({ search: '   ' }))).toHaveLength(1)
    })
  })

  it('does not change the list it is given', () => {
    const before = [...all]
    filterEntries(all, filters({ program: 'air' }))
    expect(all).toEqual(before)
  })
})

describe('hasActiveFilters', () => {
  it('is false for an untouched form, and for a search of only spaces', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(hasActiveFilters(filters({ search: '  ' }))).toBe(false)
  })

  it('is true as soon as one filter is set', () => {
    expect(hasActiveFilters(filters({ review: 'overdue' }))).toBe(true)
    expect(hasActiveFilters(filters({ search: 'air' }))).toBe(true)
  })
})

describe('sortEntries', () => {
  it('puts non-compliant first, then attention, then overdue reviews, then the rest by title', () => {
    const sorted = sortEntries([
      entry({ id: '1', title: 'Zeta compliant', compliance_status: 'compliant' }),
      entry({ id: '2', title: 'Mid overdue review', compliance_status: 'compliant', review: 'overdue' }),
      entry({ id: '3', title: 'Bravo attention', compliance_status: 'attention' }),
      entry({ id: '4', title: 'Alpha not rated', compliance_status: 'not_evaluated' }),
      entry({ id: '5', title: 'Yankee non-compliant', compliance_status: 'non_compliant' }),
      entry({ id: '6', title: 'Bravo compliant', compliance_status: 'compliant' }),
    ])
    expect(titles(sorted)).toEqual(['Yankee non-compliant', 'Bravo attention', 'Mid overdue review', 'Alpha not rated', 'Bravo compliant', 'Zeta compliant'])
  })

  it('keeps a failing entry ahead of a merely late one, even when it is also late', () => {
    const sorted = sortEntries([
      entry({ id: '1', title: 'A late', compliance_status: 'compliant', review: 'overdue' }),
      entry({ id: '2', title: 'Z failing and late', compliance_status: 'non_compliant', review: 'overdue' }),
    ])
    expect(titles(sorted)).toEqual(['Z failing and late', 'A late'])
  })

  it('orders titles within a group regardless of case', () => {
    const sorted = sortEntries([entry({ id: '1', title: 'banana' }), entry({ id: '2', title: 'Apple' }), entry({ id: '3', title: 'cherry' })])
    expect(titles(sorted)).toEqual(['Apple', 'banana', 'cherry'])
  })

  it('keeps the order it was given when entries tie, so the same input always sorts the same way', () => {
    const sorted = sortEntries([entry({ id: 'second-site', title: 'Same' }), entry({ id: 'first-site', title: 'Same' })])
    expect(sorted.map(e => e.id)).toEqual(['second-site', 'first-site'])
  })

  it('returns a copy and leaves the input alone', () => {
    const input = [entry({ id: '1', title: 'B' }), entry({ id: '2', title: 'A' })]
    const sorted = sortEntries(input)
    expect(sorted).not.toBe(input)
    expect(input.map(e => e.id)).toEqual(['1', '2'])
  })
})

describe('summarize', () => {
  const register = [
    entry({ id: '1', compliance_status: 'compliant', applicability: 'applicable', review: 'ok' }),
    entry({ id: '2', compliance_status: 'compliant', applicability: 'applicable', review: 'overdue' }),
    entry({ id: '3', compliance_status: 'attention', applicability: 'under_review', review: 'due_soon' }),
    entry({ id: '4', compliance_status: 'non_compliant', applicability: 'applicable', review: 'overdue' }),
    entry({ id: '5', compliance_status: 'not_evaluated', applicability: 'under_review', review: 'never_reviewed' }),
    entry({ id: '6', compliance_status: 'not_evaluated', applicability: 'not_applicable', review: 'never_reviewed' }),
  ]
  const counts = (entries: LegalEntry[]) => Object.fromEntries(summarize(entries).map(({ tile, count }) => [tile.label, count]))

  it('counts each rating, entries still under review, and reviews overdue', () => {
    expect(counts(register)).toEqual({
      'Compliant': 2, 'Needs attention': 1, 'Non-compliant': 1, 'Not evaluated': 1, 'Under review': 2, 'Reviews overdue': 2,
    })
  })

  it('keeps the strip in a fixed order, whatever the data', () => {
    expect(summarize([]).map(s => s.tile.label)).toEqual(['Compliant', 'Needs attention', 'Non-compliant', 'Not evaluated', 'Under review', 'Reviews overdue'])
  })

  it('counts a requirement that does not apply under neither "not evaluated" nor any rating', () => {
    const only = [entry({ applicability: 'not_applicable', compliance_status: 'not_evaluated' })]
    expect(Object.values(counts(only)).every(n => n === 0)).toBe(true)
  })

  it('gives each count as exactly the rows its click would show', () => {
    for (const { tile, count } of summarize(register)) {
      expect(filterEntries(register, toggleTile(NO_FILTERS, tile)), tile.label).toHaveLength(count)
    }
  })
})

describe('toggleTile', () => {
  const tile = (label: string) => SUMMARY_TILES.find(t => t.label === label)!
  const compliant = tile('Compliant')
  const nonCompliant = tile('Non-compliant')
  const underReview = tile('Under review')
  const overdue = tile('Reviews overdue')

  it('applies the count\'s filter, and lifts it when clicked again', () => {
    const applied = toggleTile(NO_FILTERS, nonCompliant)
    expect(applied).toEqual(filters({ compliance: 'non_compliant' }))
    expect(isTileActive(applied, nonCompliant)).toBe(true)
    expect(toggleTile(applied, nonCompliant)).toEqual(NO_FILTERS)
  })

  it('leaves the other filters as they were', () => {
    const before = filters({ program: 'air', search: 'permit', applicability: 'applicable' })
    expect(toggleTile(before, overdue)).toEqual({ ...before, review: 'overdue' })
    expect(toggleTile(toggleTile(before, overdue), overdue)).toEqual(before)
  })

  it('replaces another count in the same dimension rather than stacking', () => {
    const applied = toggleTile(toggleTile(NO_FILTERS, nonCompliant), compliant)
    expect(applied.compliance).toBe('compliant')
    expect(isTileActive(applied, nonCompliant)).toBe(false)
  })

  it('filters on applicability for the under-review count', () => {
    expect(toggleTile(NO_FILTERS, underReview)).toEqual(filters({ applicability: 'under_review' }))
  })
})

describe('verifyNoteFor', () => {
  const stubLibrary = (...entries: Array<{ id: string; verify?: string }>) => ({ library: { legal: entries } }) as unknown as ReturnType<typeof libraryForState>

  it('looks a library entry up in its own jurisdiction\'s library: a state version carries the state\'s note', () => {
    vi.mocked(libraryForState).mockImplementation(state => state === 'CA'
      ? stubLibrary({ id: 'lr-shared', verify: 'California note' })
      : stubLibrary({ id: 'lr-shared', verify: 'Federal note' }))

    expect(verifyNoteFor({ library_key: 'lr-shared', jurisdiction: 'CA' })).toBe('California note')
    expect(verifyNoteFor({ library_key: 'lr-shared', jurisdiction: 'federal' })).toBe('Federal note')
  })

  it('asks for the federal library when the jurisdiction is federal, and for the state\'s when it is a state code', () => {
    vi.mocked(libraryForState).mockImplementation(() => stubLibrary())

    verifyNoteFor({ library_key: 'lr-x', jurisdiction: 'federal' })
    verifyNoteFor({ library_key: 'lr-x', jurisdiction: 'TX' })

    expect(vi.mocked(libraryForState).mock.calls).toEqual([[null], ['TX']])
  })

  it('is null for an entry with no note, an id the library does not have, and a custom entry', () => {
    vi.mocked(libraryForState).mockImplementation(() => stubLibrary({ id: 'lr-clean' }, { id: 'lr-noted', verify: 'Check it' }))

    expect(verifyNoteFor({ library_key: 'lr-clean', jurisdiction: 'federal' })).toBeNull()
    expect(verifyNoteFor({ library_key: 'lr-gone', jurisdiction: 'federal' })).toBeNull()
    expect(verifyNoteFor({ library_key: null, jurisdiction: 'federal' })).toBeNull()
  })

  it('does not even consult the library for a custom entry', () => {
    verifyNoteFor({ library_key: null, jurisdiction: 'CA' })
    expect(libraryForState).not.toHaveBeenCalled()
  })

  it('finds every real library entry\'s own note under the jurisdiction the library stores it with', () => {
    for (const state of [null, 'CA', 'TX']) {
      for (const def of libraryForState(state).library.legal) {
        expect(verifyNoteFor({ library_key: def.id, jurisdiction: def.source }), def.id).toBe(def.verify ?? null)
      }
    }
  })

  it('does not find a state\'s entry under the federal jurisdiction', () => {
    const californiaOnly = libraryForState('CA').library.legal.find(def => def.source === 'CA')!
    expect(verifyNoteFor({ library_key: californiaOnly.id, jurisdiction: 'federal' })).toBeNull()
  })
})

describe('evaluationBody', () => {
  const draft = { applicability: 'applicable' as const, complianceStatus: 'attention' as const, note: '  Drain 3 is leaking  ', evidencePath: null }

  it('sends the rating and the trimmed note', () => {
    expect(evaluationBody(draft, { evidence_path: null })).toEqual({ applicability: 'applicable', compliance_status: 'attention', note: 'Drain 3 is leaking' })
  })

  it('sends a blank note as null', () => {
    expect(evaluationBody({ ...draft, complianceStatus: 'compliant', note: '   ' }, { evidence_path: null }).note).toBeNull()
  })

  it('rates nothing for a requirement that does not apply, whatever was selected before', () => {
    const body = evaluationBody({ ...draft, applicability: 'not_applicable', complianceStatus: 'non_compliant' }, { evidence_path: null })
    expect(body.compliance_status).toBe('not_evaluated')
    expect(body.applicability).toBe('not_applicable')
  })

  it('leaves evidence out when it is unchanged, so the entry keeps what it has', () => {
    const kept = evaluationBody({ ...draft, evidencePath: 'tenant/legal/a.pdf' }, { evidence_path: 'tenant/legal/a.pdf' })
    expect('evidence_path' in kept).toBe(false)
    expect('evidence_path' in evaluationBody(draft, { evidence_path: null })).toBe(false)
  })

  it('sends new evidence, a replacement, or null to remove it', () => {
    expect(evaluationBody({ ...draft, evidencePath: 'tenant/legal/new.pdf' }, { evidence_path: null }).evidence_path).toBe('tenant/legal/new.pdf')
    expect(evaluationBody({ ...draft, evidencePath: 'tenant/legal/new.pdf' }, { evidence_path: 'tenant/legal/old.pdf' }).evidence_path).toBe('tenant/legal/new.pdf')
    expect(evaluationBody({ ...draft, evidencePath: null }, { evidence_path: 'tenant/legal/old.pdf' }).evidence_path).toBeNull()
  })
})
