import { describe, expect, it } from 'vitest'
import {
  buildQuickReferenceGuide,
  contingencyPlanStatus,
  validateContingencyPlanInput,
  type HazardousWasteContingencyPlanInput,
} from '@soteria/core/contingencyPlan'

const NOW = new Date('2026-06-07T12:00:00Z')

const COORD = { name: 'Jane Coordinator', phone: '555-1212', role: 'Emergency Coordinator' }

function plan(over: Partial<Parameters<typeof contingencyPlanStatus>[0]> = {}) {
  return {
    emergency_coordinators: [COORD],
    qrg_submitted_at: null as string | null,
    last_amended_at: null as string | null,
    review_due_date: null as string | null,
    ...over,
  }
}

describe('contingencyPlanStatus', () => {
  it('an empty plan (no coordinators) is not "hasPlan" and QRG is not outstanding', () => {
    const s = contingencyPlanStatus(plan({ emergency_coordinators: [] }), NOW)
    expect(s.hasPlan).toBe(false)
    expect(s.qrgOutstanding).toBe(false)
  })

  it('a plan that exists but never submitted the QRG is outstanding', () => {
    const s = contingencyPlanStatus(plan(), NOW)
    expect(s.hasPlan).toBe(true)
    expect(s.qrgOutstanding).toBe(true)
  })

  it('a submitted QRG with no later amendment is satisfied', () => {
    const s = contingencyPlanStatus(plan({ qrg_submitted_at: '2026-05-01' }), NOW)
    expect(s.qrgSubmitted).toBe(true)
    expect(s.qrgOutstanding).toBe(false)
  })

  it('amending after the last QRG submission makes it outstanding again', () => {
    const s = contingencyPlanStatus(
      plan({ qrg_submitted_at: '2026-05-01', last_amended_at: '2026-05-20' }),
      NOW,
    )
    expect(s.qrgOutstanding).toBe(true)
  })

  it('amending before the submission does not make it outstanding', () => {
    const s = contingencyPlanStatus(
      plan({ last_amended_at: '2026-04-01', qrg_submitted_at: '2026-05-01' }),
      NOW,
    )
    expect(s.qrgOutstanding).toBe(false)
  })

  it('flags review due once the review date has passed', () => {
    expect(contingencyPlanStatus(plan({ review_due_date: '2026-06-01' }), NOW).reviewDue).toBe(true)
    expect(contingencyPlanStatus(plan({ review_due_date: '2026-12-01' }), NOW).reviewDue).toBe(false)
  })
})

describe('validateContingencyPlanInput', () => {
  const base: HazardousWasteContingencyPlanInput = {
    plan_document_url: null,
    max_waste_quantity: null,
    evacuation_plan: null,
    emergency_coordinators: [],
    emergency_equipment: [],
    qrg_submitted_at: null,
    qrg_submitted_to: null,
    last_amended_at: null,
    review_due_date: null,
    notes: null,
  }

  it('accepts an empty plan', () => {
    expect(validateContingencyPlanInput(base)).toEqual([])
  })

  it('requires a name on each coordinator and equipment item', () => {
    const errors = validateContingencyPlanInput({
      ...base,
      emergency_coordinators: [{ name: '', phone: '1', role: 'x' }],
      emergency_equipment: [{ name: '', location: 'shed', capabilities: '' }],
    })
    expect(errors.map(e => e.field)).toContain('emergency_coordinators[0].name')
    expect(errors.map(e => e.field)).toContain('emergency_equipment[0].name')
  })

  it('rejects invalid dates', () => {
    const errors = validateContingencyPlanInput({ ...base, qrg_submitted_at: 'not-a-date' })
    expect(errors.map(e => e.field)).toContain('qrg_submitted_at')
  })
})

describe('buildQuickReferenceGuide', () => {
  it('assembles 262.262 fields from the plan + facility', () => {
    const qrg = buildQuickReferenceGuide(
      {
        max_waste_quantity: '5,000 kg',
        emergency_coordinators: [COORD],
        emergency_equipment: [{ name: 'Spill kit', location: 'Bay 2', capabilities: 'absorbents' }],
        evacuation_plan: 'Exit north, assemble at lot C',
      },
      { facilityName: 'Acme Plant', epaIdNumber: 'CAL000111222' },
      '2026-06-07',
    )
    expect(qrg.facilityName).toBe('Acme Plant')
    expect(qrg.epaIdNumber).toBe('CAL000111222')
    expect(qrg.emergencyCoordinators[0].name).toBe('Jane Coordinator')
    expect(qrg.emergencyEquipment[0].name).toBe('Spill kit')
    expect(qrg.note).toMatch(/262\.262/)
  })
})
