import { describe, it, expect } from 'vitest'
import {
  legalRegisterCreateSchema,
  obligationCreateSchema,
  obligationCompletionSchema,
} from '@/lib/compliance/validators'

// Boundary validators. The route handlers trust these; a regression
// here means malformed rows reach Postgres.

describe('legalRegisterCreateSchema', () => {
  const minimal = { citation: '29 CFR 1910.147', title: 'LOTO', jurisdiction: 'Federal' }

  it('accepts a minimal valid payload', () => {
    const parsed = legalRegisterCreateSchema.parse(minimal)
    expect(parsed.citation).toBe('29 CFR 1910.147')
  })

  it('strips unknown fields by rejecting them', () => {
    expect(() => legalRegisterCreateSchema.parse({ ...minimal, sneaky: 'value' })).toThrow()
  })

  it('rejects empty citation / title / jurisdiction', () => {
    expect(() => legalRegisterCreateSchema.parse({ ...minimal, citation: '' })).toThrow()
    expect(() => legalRegisterCreateSchema.parse({ ...minimal, title:    '' })).toThrow()
  })

  it('coerces empty source_url to null instead of failing URL check', () => {
    const parsed = legalRegisterCreateSchema.parse({ ...minimal, source_url: '' })
    expect(parsed.source_url).toBeNull()
  })

  it('rejects a non-URL source_url', () => {
    expect(() => legalRegisterCreateSchema.parse({ ...minimal, source_url: 'notaurl' })).toThrow()
  })

  it('accepts tags up to 20 items', () => {
    const tags = Array.from({ length: 20 }, (_, i) => `t${i}`)
    legalRegisterCreateSchema.parse({ ...minimal, tags })
    expect(() => legalRegisterCreateSchema.parse({ ...minimal, tags: [...tags, 'overflow'] })).toThrow()
  })
})

describe('obligationCreateSchema', () => {
  const minimal = {
    title:         'Quarterly fire-extinguisher inspection',
    next_due_date: '2026-08-15',
  }

  it('applies defaults: annual frequency, lead_days=14, evidence_required=false', () => {
    const parsed = obligationCreateSchema.parse(minimal)
    expect(parsed.frequency).toBe('annual')
    expect(parsed.lead_days).toBe(14)
    expect(parsed.evidence_required).toBe(false)
    expect(parsed.not_applicable).toBe(false)
  })

  it('rejects bad date format', () => {
    expect(() => obligationCreateSchema.parse({ ...minimal, next_due_date: '8/15/2026' })).toThrow()
  })

  it('requires frequency_days when frequency=custom_days', () => {
    expect(() => obligationCreateSchema.parse({ ...minimal, frequency: 'custom_days' })).toThrow()
    obligationCreateSchema.parse({ ...minimal, frequency: 'custom_days', frequency_days: 60 })
  })

  it('rejects unknown category', () => {
    expect(() => obligationCreateSchema.parse({ ...minimal, category: 'unknown' as never })).toThrow()
  })

  it('rejects lead_days > 365', () => {
    expect(() => obligationCreateSchema.parse({ ...minimal, lead_days: 366 })).toThrow()
  })
})

describe('obligationCompletionSchema', () => {
  it('accepts an empty body', () => {
    const parsed = obligationCompletionSchema.parse({})
    expect(parsed.notes).toBeUndefined()
  })

  it('coerces empty evidence_url to null', () => {
    const parsed = obligationCompletionSchema.parse({ evidence_url: '' })
    expect(parsed.evidence_url).toBeNull()
  })

  it('rejects a non-URL evidence', () => {
    expect(() => obligationCompletionSchema.parse({ evidence_url: 'nope' })).toThrow()
  })
})
