import { describe, it, expect } from 'vitest'
import {
  HAZARD_CONTROL_HIERARCHY,
  HAZARD_CONTROL_LABEL,
  normalizeHierarchyLevel,
  summarizeControls,
  type HazardControl,
} from '@soteria/core/hazardControls'

describe('HAZARD_CONTROL_HIERARCHY', () => {
  it('lists every level once, in ISO 45001 8.1.2 order (top first)', () => {
    expect([...HAZARD_CONTROL_HIERARCHY]).toEqual([
      'eliminate', 'substitute', 'engineering', 'administrative', 'ppe',
    ])
  })

  it('has a human label for every level', () => {
    for (const lv of HAZARD_CONTROL_HIERARCHY) {
      expect(HAZARD_CONTROL_LABEL[lv]).toBeTruthy()
    }
  })
})

describe('normalizeHierarchyLevel', () => {
  it('accepts the canonical short form unchanged', () => {
    expect(normalizeHierarchyLevel('eliminate')).toBe('eliminate')
    expect(normalizeHierarchyLevel('substitute')).toBe('substitute')
    expect(normalizeHierarchyLevel('engineering')).toBe('engineering')
    expect(normalizeHierarchyLevel('administrative')).toBe('administrative')
    expect(normalizeHierarchyLevel('ppe')).toBe('ppe')
  })

  it('maps the DB long form to the canonical short form', () => {
    expect(normalizeHierarchyLevel('elimination')).toBe('eliminate')
    expect(normalizeHierarchyLevel('substitution')).toBe('substitute')
  })

  it('returns null on unrecognised values', () => {
    expect(normalizeHierarchyLevel('safety_glasses')).toBeNull()
    expect(normalizeHierarchyLevel('')).toBeNull()
    expect(normalizeHierarchyLevel(null)).toBeNull()
    expect(normalizeHierarchyLevel(undefined)).toBeNull()
  })
})

describe('summarizeControls', () => {
  it('returns all-zero counts and null topOfStack for an empty list', () => {
    const sum = summarizeControls([])
    expect(sum.total).toBe(0)
    expect(sum.topOfStack).toBeNull()
    for (const lv of HAZARD_CONTROL_HIERARCHY) {
      expect(sum.counts[lv]).toBe(0)
    }
  })

  it('reports PPE-only mixes accurately and flags PPE as the top of the stack', () => {
    const controls: HazardControl[] = [
      { hierarchy_level: 'ppe' },
      { hierarchy_level: 'ppe' },
      { hierarchy_level: 'ppe' },
    ]
    const sum = summarizeControls(controls)
    expect(sum.counts.ppe).toBe(3)
    expect(sum.total).toBe(3)
    expect(sum.topOfStack).toBe('ppe')
  })

  it('selects the highest level in a mixed bag', () => {
    const controls: HazardControl[] = [
      { hierarchy_level: 'ppe' },
      { hierarchy_level: 'administrative' },
      { hierarchy_level: 'engineering' },
      { hierarchy_level: 'ppe' },
    ]
    const sum = summarizeControls(controls)
    expect(sum.counts.engineering).toBe(1)
    expect(sum.counts.administrative).toBe(1)
    expect(sum.counts.ppe).toBe(2)
    expect(sum.topOfStack).toBe('engineering')
  })

  it('honors Eliminate over every lower level', () => {
    const controls: HazardControl[] = [
      { hierarchy_level: 'ppe' },
      { hierarchy_level: 'engineering' },
      { hierarchy_level: 'eliminate' },
    ]
    expect(summarizeControls(controls).topOfStack).toBe('eliminate')
  })

  it('accepts the long form via normalizeHierarchyLevel', () => {
    const controls: HazardControl[] = [
      { hierarchy_level: 'elimination' },
      { hierarchy_level: 'substitution' },
    ]
    const sum = summarizeControls(controls)
    expect(sum.counts.eliminate).toBe(1)
    expect(sum.counts.substitute).toBe(1)
    expect(sum.topOfStack).toBe('eliminate')
  })

  it('silently drops unrecognised values', () => {
    const controls: HazardControl[] = [
      { hierarchy_level: 'eliminate' },
      { hierarchy_level: 'safety_glasses' },              // junk
      { hierarchy_level: 'training_pop_quiz' },           // junk
    ]
    const sum = summarizeControls(controls)
    expect(sum.total).toBe(1)
    expect(sum.counts.eliminate).toBe(1)
  })
})
