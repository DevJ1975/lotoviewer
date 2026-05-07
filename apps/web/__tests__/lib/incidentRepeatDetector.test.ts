import { describe, it, expect } from 'vitest'
import {
  detectRepeatIncidents,
  type RepeatCandidate,
} from '@soteria/core/incidentRepeatDetector'

const focal: RepeatCandidate = {
  id:                              'focal',
  report_number:                   'INC-2026-0050',
  occurred_at:                     '2026-04-15T00:00:00Z',
  incident_type:                   'injury_illness',
  description:                     'Worker slipped on hydraulic oil leak from forklift in loading dock',
  location_text:                   'Loading Dock B',
  related_loto_permit_id:          null,
  related_hot_work_permit_id:      null,
  related_confined_space_permit_id: null,
  related_jha_id:                  null,
  body_parts:                      ['back_lower'],
}

function make(over: Partial<RepeatCandidate>): RepeatCandidate {
  return {
    id: 'c1', report_number: 'INC-X', occurred_at: '2026-04-01T00:00:00Z',
    incident_type: 'injury_illness',
    description: 'unrelated event',
    location_text: 'Office', body_parts: null,
    ...over,
  }
}

describe('detectRepeatIncidents', () => {
  it('returns nothing when the pool is empty', () => {
    expect(detectRepeatIncidents(focal, [])).toEqual([])
  })

  it('skips the focal incident itself', () => {
    expect(detectRepeatIncidents(focal, [focal])).toEqual([])
  })

  it('matches on shared location_text (case-insensitive, trimmed)', () => {
    const cand = make({ id: 'c1', location_text: 'loading dock b  ' })
    const matches = detectRepeatIncidents(focal, [cand])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.reasons.join(' ')).toMatch(/location/i)
  })

  it('matches on description keyword overlap (Jaccard)', () => {
    const cand = make({
      id: 'c2',
      location_text: null,
      description: 'Hydraulic oil leak from another forklift caused a slip in the warehouse',
    })
    const matches = detectRepeatIncidents(focal, [cand])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.reasons.some(r => /description/i.test(r))).toBe(true)
  })

  it('matches on shared LOTO permit id', () => {
    const focalWithPermit: RepeatCandidate = { ...focal, related_loto_permit_id: 'perm-1' }
    const cand = make({
      id: 'c3', location_text: null, description: 'unrelated',
      related_loto_permit_id: 'perm-1',
    })
    const matches = detectRepeatIncidents(focalWithPermit, [cand])
    expect(matches).toHaveLength(1)
    expect(matches[0]!.reasons.some(r => /LOTO/i.test(r))).toBe(true)
  })

  it('matches on body-part overlap', () => {
    const cand = make({
      id: 'c4', location_text: 'Different place', description: 'totally different',
      body_parts: ['back_lower', 'shoulder_left'],
    })
    const matches = detectRepeatIncidents(focal, [cand], { threshold: 0.05 })
    expect(matches.length).toBeGreaterThanOrEqual(1)
    expect(matches[0]!.reasons.some(r => /body part/i.test(r))).toBe(true)
  })

  it('respects the threshold', () => {
    // No reasonable match.
    const cand = make({
      id: 'c5', location_text: 'Other facility',
      description: 'A car drove past the building peacefully',
      body_parts: ['eye_left'],
      incident_type: 'environmental',
    })
    const matches = detectRepeatIncidents(focal, [cand], { threshold: 0.5 })
    expect(matches).toEqual([])
  })

  it('sorts matches by score descending', () => {
    const a = make({ id: 'a', location_text: 'Loading Dock B', description: 'unrelated' })
    const b = make({
      id: 'b', location_text: 'Loading Dock B',
      description: 'Hydraulic oil leak from forklift in loading dock',
      body_parts: ['back_lower'],
    })
    const matches = detectRepeatIncidents(focal, [a, b])
    expect(matches[0]!.candidate.id).toBe('b')   // higher overlap wins
  })

  it('caps result count to opts.limit', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => make({
      id: `c${i}`,
      location_text: 'Loading Dock B',
      description: 'forklift slip oil',
    }))
    const matches = detectRepeatIncidents(focal, candidates, { limit: 3 })
    expect(matches).toHaveLength(3)
  })
})
