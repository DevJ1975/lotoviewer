import { describe, it, expect } from 'vitest'
import {
  validateChecklist,
  checklistReady,
  FIRE_EXTINGUISHER_TYPES,
} from '@soteria/core/hotWorkChecklist'
import type { HotWorkPreChecks } from '@soteria/core/types'

// Convenience: a fully-passing checklist as a baseline for each test
// to mutate one field at a time.
function full(): HotWorkPreChecks {
  return {
    combustibles_cleared_35ft:    true,
    floor_swept:                  true,
    floor_openings_protected:     true,
    wall_openings_protected:      true,
    sprinklers_operational:       true,
    ventilation_adequate:         true,
    fire_extinguisher_present:    true,
    fire_extinguisher_type:       'ABC',
    curtains_or_shields_in_place: true,
    adjacent_areas_notified:      true,
  }
}

// ── validateChecklist ─────────────────────────────────────────────────────

describe('validateChecklist', () => {
  it('accepts a complete checklist with no issues', () => {
    expect(validateChecklist(full())).toEqual([])
  })

  it('flags every required boolean that is undefined or false', () => {
    const empty: HotWorkPreChecks = {}
    const codes = validateChecklist(empty).map(i => i.code)
    // 8 required booleans + 1 sprinklers (which is also missing) = 9 issues
    expect(codes).toContain('combustibles')
    expect(codes).toContain('floor_swept')
    expect(codes).toContain('floor_openings')
    expect(codes).toContain('wall_openings')
    expect(codes).toContain('ventilation')
    expect(codes).toContain('extinguisher_present')
    expect(codes).toContain('curtains')
    expect(codes).toContain('adjacent_notified')
    expect(codes).toContain('sprinklers')
  })

  it('flags individual required checks set to false', () => {
    expect(validateChecklist({ ...full(), combustibles_cleared_35ft: false })
      .map(i => i.code)).toContain('combustibles')
  })

  it('requires alternate-protection text when sprinklers are out of service', () => {
    const codes = validateChecklist({
      ...full(),
      sprinklers_operational:        false,
      alternate_protection_if_no_spr: '',
    }).map(i => i.code)
    expect(codes).toContain('sprinklers_alternate')
  })

  it('accepts sprinklers-out when alternate protection is described', () => {
    const codes = validateChecklist({
      ...full(),
      sprinklers_operational:        false,
      alternate_protection_if_no_spr: 'Two ABC extinguishers staged at corners; dedicated watcher.',
    }).map(i => i.code)
    expect(codes).not.toContain('sprinklers_alternate')
  })

  it('flags when sprinkler status is unspecified (undefined boolean)', () => {
    const checks: HotWorkPreChecks = { ...full() }
    delete checks.sprinklers_operational
    const codes = validateChecklist(checks).map(i => i.code)
    expect(codes).toContain('sprinklers')
  })

  it('requires fire-extinguisher type when present is true', () => {
    const codes = validateChecklist({
      ...full(),
      fire_extinguisher_present: true,
      fire_extinguisher_type:    '',
    }).map(i => i.code)
    expect(codes).toContain('extinguisher_type')
  })

  it('does not flag extinguisher type when present is false (already blocked by extinguisher_present)', () => {
    const codes = validateChecklist({
      ...full(),
      fire_extinguisher_present: false,
      fire_extinguisher_type:    null,
    }).map(i => i.code)
    expect(codes).toContain('extinguisher_present')
    expect(codes).not.toContain('extinguisher_type')   // skipped because present=false
  })

  it('treats null gas_lines_isolated as N/A — no issue raised', () => {
    expect(validateChecklist({ ...full(), gas_lines_isolated: null })
      .map(i => i.code)).not.toContain('gas_lines')
  })

  it('flags gas_lines_isolated explicitly false (gas present, not isolated)', () => {
    expect(validateChecklist({ ...full(), gas_lines_isolated: false })
      .map(i => i.code)).toContain('gas_lines')
  })

  it('does not flag gas_lines_isolated true', () => {
    expect(validateChecklist({ ...full(), gas_lines_isolated: true })
      .map(i => i.code)).not.toContain('gas_lines')
  })

  it('whitespace-only alternate_protection_if_no_spr counts as missing', () => {
    expect(validateChecklist({
      ...full(),
      sprinklers_operational:        false,
      alternate_protection_if_no_spr: '    ',
    }).map(i => i.code)).toContain('sprinklers_alternate')
  })

  it('whitespace-only fire_extinguisher_type counts as missing', () => {
    expect(validateChecklist({
      ...full(),
      fire_extinguisher_present: true,
      fire_extinguisher_type:    '   ',
    }).map(i => i.code)).toContain('extinguisher_type')
  })
})

// ── checklistReady ────────────────────────────────────────────────────────

describe('checklistReady', () => {
  it('is true for a complete checklist', () => {
    expect(checklistReady(full())).toBe(true)
  })

  it('is false for any missing required check', () => {
    expect(checklistReady({ ...full(), combustibles_cleared_35ft: false })).toBe(false)
  })

  it('is false on an empty object', () => {
    expect(checklistReady({})).toBe(false)
  })
})

// ── FIRE_EXTINGUISHER_TYPES ───────────────────────────────────────────────

describe('FIRE_EXTINGUISHER_TYPES', () => {
  it('includes the four common workplace classes', () => {
    expect(FIRE_EXTINGUISHER_TYPES).toContain('ABC')
    expect(FIRE_EXTINGUISHER_TYPES).toContain('CO2')
    expect(FIRE_EXTINGUISHER_TYPES).toContain('Class D')
    expect(FIRE_EXTINGUISHER_TYPES).toContain('Class K')
  })
})
