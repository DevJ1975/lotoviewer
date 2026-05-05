import { describe, it, expect } from 'vitest'
import {
  WIZARD_STEPS,
  buildSubmitPayload,
  makeInitialWizardState,
  validateAssign,
  validateCategorize,
  validateConfirm,
  validateControls,
  validateIdentify,
  validateInherent,
  validateResidual,
  validateReview,
  validateStep,
  type WizardState,
} from '@/lib/risk-wizard'

// Wizard step validators + the submit-payload builder. These are
// the same validators the UI calls to gate the Next button, and
// the payload builder is what hands the API the body it expects.
// Drift between the validators / API contract here surfaces as a
// 400/422 in production; the tests pin the contract explicitly.

function fillValid(over: Partial<WizardState> = {}): WizardState {
  return {
    ...makeInitialWizardState(),
    title:               'Forklift collision near loading dock',
    description:         'Workers entering the dock turn on foot have limited visibility of forklifts approaching the corner.',
    source:              'inspection',
    source_ref_id:       '',
    hazard_category:     'mechanical',
    location:            'Dock 4',
    process:             'Shipping & receiving',
    activity_type:       'routine',
    affected_personnel:  { workers: true, contractors: true, visitors: false, public: false },
    exposure_frequency:  'daily',
    inherent_severity:   4,
    inherent_likelihood: 3,
    controls:            [],
    ppe_only_justification: '',
    residual_severity:   0,
    residual_likelihood: 0,
    assigned_to:         '',
    reviewer:            '',
    approver:            '',
    next_review_date:    new Date(Date.now() + 180 * 86_400_000).toISOString().slice(0, 10),
    ...over,
  }
}

describe('WIZARD_STEPS', () => {
  it('has 8 steps in the expected order', () => {
    expect(WIZARD_STEPS.map(s => s.id)).toEqual([
      'identify', 'categorize', 'inherent', 'controls',
      'residual', 'assign', 'review', 'confirm',
    ])
  })
})

describe('validateIdentify', () => {
  it('rejects empty title', () => {
    expect(validateIdentify(fillValid({ title: '' }))).toMatch(/title/i)
  })
  it('rejects short title', () => {
    expect(validateIdentify(fillValid({ title: 'a b' }))).toMatch(/short/i)
  })
  it('rejects empty description', () => {
    expect(validateIdentify(fillValid({ description: '' }))).toMatch(/description/i)
  })
  it('rejects too-short description', () => {
    expect(validateIdentify(fillValid({ description: 'short' }))).toMatch(/explain/i)
  })
  it('accepts a complete identify state', () => {
    expect(validateIdentify(fillValid())).toBeNull()
  })
})

describe('validateCategorize', () => {
  it('rejects when hazard_category is empty', () => {
    expect(validateCategorize(fillValid({ hazard_category: '' }))).toMatch(/category/i)
  })
  it('accepts any valid category', () => {
    expect(validateCategorize(fillValid({ hazard_category: 'psychosocial' }))).toBeNull()
  })
})

describe('validateInherent', () => {
  it('requires both severity and likelihood', () => {
    expect(validateInherent(fillValid({ inherent_severity: 0 }))).toMatch(/severity/i)
    expect(validateInherent(fillValid({ inherent_likelihood: 0 }))).toMatch(/likelihood/i)
  })
  it('accepts a fully-scored inherent', () => {
    expect(validateInherent(fillValid({ inherent_severity: 5, inherent_likelihood: 5 }))).toBeNull()
  })
})

describe('validateControls', () => {
  it('accepts zero controls (user can score residual / submit later)', () => {
    expect(validateControls(fillValid({ controls: [] }))).toBeNull()
  })

  it('rejects controls with empty display_name', () => {
    const s = fillValid({
      controls: [{ localId: 'a', control_id: null, hierarchy_level: 'engineering', display_name: '   ', notes: '' }],
    })
    expect(validateControls(s)).toMatch(/name/i)
  })

  it('does not require justification when inherent_score < 8 even if all controls are PPE', () => {
    const s = fillValid({
      inherent_severity:   2, inherent_likelihood: 2,         // score 4 (moderate)
      controls: [{ localId: 'a', control_id: null, hierarchy_level: 'ppe', display_name: 'gloves', notes: '' }],
    })
    expect(validateControls(s)).toBeNull()
  })

  it('requires justification when inherent_score >= 8 and all controls are PPE', () => {
    const s = fillValid({
      inherent_severity:   4, inherent_likelihood: 3,         // score 12 (high)
      controls: [
        { localId: 'a', control_id: null, hierarchy_level: 'ppe', display_name: 'gloves',     notes: '' },
        { localId: 'b', control_id: null, hierarchy_level: 'ppe', display_name: 'hard hat',   notes: '' },
      ],
    })
    expect(validateControls(s)).toMatch(/PPE-alone/i)
  })

  it('accepts when justification is present even with all PPE at high inherent', () => {
    const s = fillValid({
      inherent_severity:   4, inherent_likelihood: 3,
      ppe_only_justification: 'Plant retrofit not feasible until 2027 capex cycle.',
      controls: [{ localId: 'a', control_id: null, hierarchy_level: 'ppe', display_name: 'gloves', notes: '' }],
    })
    expect(validateControls(s)).toBeNull()
  })

  it('accepts when at least one non-PPE control is present at high inherent', () => {
    const s = fillValid({
      inherent_severity:   4, inherent_likelihood: 3,
      controls: [
        { localId: 'a', control_id: null, hierarchy_level: 'engineering', display_name: 'guard',  notes: '' },
        { localId: 'b', control_id: null, hierarchy_level: 'ppe',         display_name: 'gloves', notes: '' },
      ],
    })
    expect(validateControls(s)).toBeNull()
  })
})

describe('validateResidual', () => {
  it('accepts skipping residual entirely (both 0)', () => {
    expect(validateResidual(fillValid({ residual_severity: 0, residual_likelihood: 0 }))).toBeNull()
  })
  it('rejects partial residual (severity set, likelihood not)', () => {
    expect(validateResidual(fillValid({ residual_severity: 3, residual_likelihood: 0 }))).toMatch(/likelihood/i)
  })
  it('rejects partial residual (likelihood set, severity not)', () => {
    expect(validateResidual(fillValid({ residual_severity: 0, residual_likelihood: 3 }))).toMatch(/severity/i)
  })
  it('accepts a fully-scored residual', () => {
    expect(validateResidual(fillValid({ residual_severity: 2, residual_likelihood: 2 }))).toBeNull()
  })
})

describe('validateAssign', () => {
  it('always passes — assignment is optional in slice 3', () => {
    expect(validateAssign(fillValid())).toBeNull()
  })
})

describe('validateReview', () => {
  it('rejects empty next_review_date', () => {
    expect(validateReview(fillValid({ next_review_date: '' }))).toMatch(/date/i)
  })
  it('rejects malformed dates', () => {
    expect(validateReview(fillValid({ next_review_date: '01/01/2030' }))).toMatch(/YYYY-MM-DD/)
  })
  it('rejects past dates', () => {
    expect(validateReview(fillValid({ next_review_date: '2020-01-01' }))).toMatch(/past/i)
  })
  it('accepts a valid future date', () => {
    const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10)
    expect(validateReview(fillValid({ next_review_date: future }))).toBeNull()
  })
})

describe('validateConfirm', () => {
  it('aggregates every prior validator', () => {
    expect(validateConfirm(fillValid())).toBeNull()
    expect(validateConfirm(fillValid({ title: '' }))).toMatch(/title/i)
    expect(validateConfirm(fillValid({ hazard_category: '' }))).toMatch(/category/i)
  })
})

describe('validateStep', () => {
  it('dispatches by step id', () => {
    expect(validateStep('identify',   fillValid({ title: '' }))).toMatch(/title/i)
    expect(validateStep('categorize', fillValid({ hazard_category: '' }))).toMatch(/category/i)
    expect(validateStep('inherent',   fillValid({ inherent_severity: 0 }))).toMatch(/severity/i)
    expect(validateStep('confirm',    fillValid())).toBeNull()
  })
})

describe('buildSubmitPayload', () => {
  it('returns the expected risk shape with controls', () => {
    const s = fillValid({
      controls: [
        { localId: 'a', control_id: null, hierarchy_level: 'engineering', display_name: 'Machine guard', notes: 'fixed barrier' },
        { localId: 'b', control_id: '00000000-0000-0000-0000-000000000abc', hierarchy_level: 'ppe', display_name: 'Gloves', notes: '' },
      ],
      residual_severity: 2, residual_likelihood: 2,
    })
    const p = buildSubmitPayload(s)
    expect(p.risk.title).toBe('Forklift collision near loading dock')
    expect(p.risk.hazard_category).toBe('mechanical')
    expect(p.risk.inherent_severity).toBe(4)
    expect(p.risk.residual_severity).toBe(2)
    expect(p.risk.residual_likelihood).toBe(2)
    expect(p.controls).toHaveLength(2)
    // Custom control passes custom_name + no control_id
    expect(p.controls[0]).toMatchObject({ hierarchy_level: 'engineering', custom_name: 'Machine guard' })
    expect(p.controls[0]?.control_id).toBeUndefined()
    // Library-linked control passes control_id + no custom_name
    expect(p.controls[1]).toMatchObject({ hierarchy_level: 'ppe', control_id: '00000000-0000-0000-0000-000000000abc' })
    expect(p.controls[1]?.custom_name).toBeUndefined()
  })

  it('emits null for skipped residual fields', () => {
    const p = buildSubmitPayload(fillValid({ residual_severity: 0, residual_likelihood: 0 }))
    expect(p.risk.residual_severity).toBeNull()
    expect(p.risk.residual_likelihood).toBeNull()
  })

  it('coerces non-uuid assignment fields to null', () => {
    const p = buildSubmitPayload(fillValid({ assigned_to: 'jamil', reviewer: '', approver: '00000000-0000-0000-0000-000000000123' }))
    expect(p.risk.assigned_to).toBeNull()
    expect(p.risk.reviewer).toBeNull()
    expect(p.risk.approver).toBe('00000000-0000-0000-0000-000000000123')
  })

  it('trims long-text fields and falls back to null when blank', () => {
    const p = buildSubmitPayload(fillValid({ location: '   ', process: '  Plant 4  ', ppe_only_justification: '   ' }))
    expect(p.risk.location).toBeNull()
    expect(p.risk.process).toBe('Plant 4')
    expect(p.risk.ppe_only_justification).toBeNull()
  })
})
