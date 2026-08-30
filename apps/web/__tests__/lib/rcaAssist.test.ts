import { describe, it, expect } from 'vitest'
import {
  nextWhyPrompt,
  detectSymptomLanguage,
  buildRootCauseActionDraft,
} from '@soteria/core/rcaSchemas'

// Pure-logic tests for the redesigned 5 Whys helpers: contextual prompt
// chaining, the anti-blame guardrail, and the root-cause→action seed.

describe('nextWhyPrompt', () => {
  it('returns the problem-statement prompt when there is no parent answer', () => {
    expect(nextWhyPrompt()).toBe('What happened?')
    expect(nextWhyPrompt('')).toBe('What happened?')
    expect(nextWhyPrompt('   ')).toBe('What happened?')
    expect(nextWhyPrompt(null)).toBe('What happened?')
  })

  it('chains the prompt to the answer it interrogates', () => {
    expect(nextWhyPrompt('the guard was removed')).toBe('Why did "the guard was removed" happen?')
  })

  it('collapses whitespace in the echoed answer', () => {
    expect(nextWhyPrompt('the   guard\nwas removed')).toBe('Why did "the guard was removed" happen?')
  })

  it('clips a long answer with an ellipsis', () => {
    const long = 'a'.repeat(200)
    const out = nextWhyPrompt(long)
    expect(out.startsWith('Why did "')).toBe(true)
    expect(out.endsWith('…" happen?')).toBe(true)
    // Echoed segment is clipped well under the raw length.
    expect(out.length).toBeLessThan(long.length)
  })
})

describe('detectSymptomLanguage', () => {
  it('flags person-blaming answers as blame', () => {
    for (const phrase of [
      'it was human error',
      'the operator was careless',
      'he was not paying attention',
      'the crew got complacent',
      'this was a procedure violation',
    ]) {
      const r = detectSymptomLanguage(phrase)
      expect(r.flagged).toBe(true)
      expect(r.category).toBe('blame')
      expect(r.reason).toBeTruthy()
    }
  })

  it('flags symptom-level fixes as symptom', () => {
    for (const phrase of [
      'we need to retrain the worker',
      'the technician forgot the step',
      'they did not follow the procedure',
    ]) {
      const r = detectSymptomLanguage(phrase)
      expect(r.flagged).toBe(true)
      expect(r.category).toBe('symptom')
    }
  })

  it('does not flag a systemic, blame-free answer', () => {
    const r = detectSymptomLanguage(
      'the interlock was bypassable because the design allowed the door to open under power',
    )
    expect(r.flagged).toBe(false)
    expect(r.reason).toBeUndefined()
  })

  it('does not flag empty input', () => {
    expect(detectSymptomLanguage('').flagged).toBe(false)
    expect(detectSymptomLanguage('   ').flagged).toBe(false)
  })
})

describe('buildRootCauseActionDraft', () => {
  it('seeds a corrective action from the root-cause text', () => {
    const d = buildRootCauseActionDraft({ rootCauseText: 'no machine-level interlock' })
    expect(d.action_type).toBe('corrective')
    expect(d.hierarchy_of_controls).toBeNull()
    expect(d.description).toContain('no machine-level interlock')
  })

  it('falls back to a generic description for empty root text', () => {
    const d = buildRootCauseActionDraft({ rootCauseText: '   ' })
    expect(d.action_type).toBe('corrective')
    expect(d.description.length).toBeGreaterThan(0)
  })
})
