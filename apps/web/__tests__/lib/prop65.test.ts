import { describe, it, expect } from 'vitest'
import {
  classifyExposure,
  type Prop65Chemical,
} from '@soteria/core/prop65'

// Cross-reference: migration 173 + the /admin/chemicals/prop65/assessments/new
// form rely on classifyExposure returning EXACTLY these values.

const lead: Pick<Prop65Chemical, 'nsrl_mg_day' | 'madl_mg_day'> = {
  nsrl_mg_day: 0.015,  // cancer
  madl_mg_day: 0.0005, // reproductive
}

const cancerOnly = { nsrl_mg_day: 0.04, madl_mg_day: null }
const reproOnly  = { nsrl_mg_day: null, madl_mg_day: 0.003 }
const noNumbers  = { nsrl_mg_day: null, madl_mg_day: null }

describe('classifyExposure', () => {
  describe('cancer endpoint', () => {
    it('just below NSRL clears as below_safe_harbor', () => {
      expect(classifyExposure(0.014999, cancerOnly, 'cancer')).toBe('below_safe_harbor')
    })

    it('exactly at NSRL does NOT clear (strict less-than)', () => {
      // OEHHA numbers are upper bounds — sitting on the line is not a defense.
      expect(classifyExposure(0.04, cancerOnly, 'cancer')).toBe('requires_warning')
    })

    it('just above NSRL requires a warning', () => {
      expect(classifyExposure(0.041, cancerOnly, 'cancer')).toBe('requires_warning')
    })

    it('missing nsrl is unknown even when below madl', () => {
      // Fail-safe — without the cancer number we can't claim cleared.
      expect(classifyExposure(0.0001, reproOnly, 'cancer')).toBe('unknown')
    })
  })

  describe('reproductive endpoint', () => {
    it('just below MADL clears', () => {
      expect(classifyExposure(0.0029, reproOnly, 'reproductive')).toBe('below_safe_harbor')
    })

    it('exactly at MADL requires a warning', () => {
      expect(classifyExposure(0.003, reproOnly, 'reproductive')).toBe('requires_warning')
    })

    it('missing madl is unknown', () => {
      expect(classifyExposure(0.001, cancerOnly, 'reproductive')).toBe('unknown')
    })
  })

  describe('both endpoint', () => {
    it('clears only when below both NSRL and MADL', () => {
      expect(classifyExposure(0.0001, lead, 'both')).toBe('below_safe_harbor')
    })

    it('above madl but below nsrl still requires warning', () => {
      // Lead madl=0.0005, nsrl=0.015 — 0.001 > 0.0005 → warning.
      expect(classifyExposure(0.001, lead, 'both')).toBe('requires_warning')
    })

    it('missing nsrl makes both unknown even if below madl', () => {
      expect(classifyExposure(0.0001, reproOnly, 'both')).toBe('unknown')
    })

    it('missing madl makes both unknown even if below nsrl', () => {
      expect(classifyExposure(0.001, cancerOnly, 'both')).toBe('unknown')
    })

    it('all numbers missing is unknown', () => {
      expect(classifyExposure(0.0001, noNumbers, 'both')).toBe('unknown')
    })
  })

  describe('input validation', () => {
    it('NaN daily_mg is unknown, not a crash', () => {
      expect(classifyExposure(Number.NaN, lead, 'both')).toBe('unknown')
    })

    it('negative daily_mg is unknown', () => {
      expect(classifyExposure(-1, lead, 'cancer')).toBe('unknown')
    })

    it('zero clears cleanly when both numbers present', () => {
      expect(classifyExposure(0, lead, 'both')).toBe('below_safe_harbor')
    })
  })
})
