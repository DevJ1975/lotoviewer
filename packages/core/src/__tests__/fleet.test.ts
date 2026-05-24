import { describe, it, expect } from 'vitest'
import {
  validateVehicleInput, validatePlacard, validateDocumentInput, checkHazmatConsistency,
} from '../fleet'
import { validateDriverInput } from '../fleetDriver'
import { buildFleetExpiryDigest } from '../fleetExpiry'

describe('validateVehicleInput', () => {
  it('requires at least one identifier', () => {
    expect(validateVehicleInput({})).toMatch(/unit number, VIN, or license plate/)
    expect(validateVehicleInput({ unit_number: 'T-1' })).toBeNull()
    expect(validateVehicleInput({ vin: '1FT' })).toBeNull()
  })

  it('rejects bad enums and numbers', () => {
    expect(validateVehicleInput({ unit_number: 'T-1', vehicle_type: 'spaceship' as never })).toMatch(/vehicle_type/)
    expect(validateVehicleInput({ unit_number: 'T-1', fuel_type: 'coal' as never })).toMatch(/fuel_type/)
    expect(validateVehicleInput({ unit_number: 'T-1', dot_vehicle_class: '9' as never })).toMatch(/dot_vehicle_class/)
    expect(validateVehicleInput({ unit_number: 'T-1', model_year: 1700 })).toMatch(/model_year/)
    expect(validateVehicleInput({ unit_number: 'T-1', gvwr_lbs: -5 })).toMatch(/gvwr_lbs/)
    expect(validateVehicleInput({ unit_number: 'T-1', annual_dot_inspection_at: '03/01/2026' })).toMatch(/YYYY-MM-DD/)
  })

  it('accepts a fully-specified valid vehicle', () => {
    expect(validateVehicleInput({
      unit_number: 'T-104', vehicle_type: 'tractor', status: 'active', fuel_type: 'diesel',
      dot_vehicle_class: '8', model_year: 2022, gvwr_lbs: 33000, annual_dot_inspection_at: '2026-01-15',
    })).toBeNull()
  })
})

describe('validatePlacard', () => {
  it('requires a valid hazard class', () => {
    expect(validatePlacard({})).toMatch(/hazard_class/)
    expect(validatePlacard({ hazard_class: '12' as never })).toMatch(/hazard_class/)
    expect(validatePlacard({ hazard_class: '3' })).toBeNull()
  })
  it('validates UN number + division shape', () => {
    expect(validatePlacard({ hazard_class: '3', un_number: 'XYZ' })).toMatch(/un_number/)
    expect(validatePlacard({ hazard_class: '3', un_number: 'UN1203' })).toBeNull()
    expect(validatePlacard({ hazard_class: '3', un_number: '1203' })).toBeNull()
    expect(validatePlacard({ hazard_class: '1', division: 'x.y' })).toMatch(/division/)
    expect(validatePlacard({ hazard_class: '1', division: '1.1' })).toBeNull()
  })
})

describe('validateDocumentInput', () => {
  it('requires a known doc_type', () => {
    expect(validateDocumentInput({})).toMatch(/doc_type/)
    expect(validateDocumentInput({ doc_type: 'insurance' })).toBeNull()
  })
  it('rejects expiry before issue', () => {
    expect(validateDocumentInput({ doc_type: 'insurance', issued_at: '2026-05-01', expires_at: '2026-04-01' })).toMatch(/before issued_at/)
    expect(validateDocumentInput({ doc_type: 'insurance', issued_at: '2026-01-01', expires_at: '2027-01-01' })).toBeNull()
  })
})

describe('checkHazmatConsistency', () => {
  it('flags hazmat with no detail', () => {
    const r = checkHazmatConsistency({ carriesHazmat: true, placardCount: 0, chemicalCount: 0 })
    expect(r.missingDetail).toBe(true)
    expect(r.messages.length).toBeGreaterThan(0)
  })
  it('flags placards without the hazmat flag', () => {
    const r = checkHazmatConsistency({ carriesHazmat: false, placardCount: 2, chemicalCount: 0 })
    expect(r.flagMismatch).toBe(true)
  })
  it('nudges to link an SDS when placards exist but no chemical', () => {
    const r = checkHazmatConsistency({ carriesHazmat: true, placardCount: 1, chemicalCount: 0 })
    expect(r.messages.some(m => /SDS/.test(m))).toBe(true)
  })
  it('is clean when consistent', () => {
    const r = checkHazmatConsistency({ carriesHazmat: true, placardCount: 1, chemicalCount: 1 })
    expect(r.messages).toHaveLength(0)
  })
})

describe('validateDriverInput', () => {
  it('requires a worker on create', () => {
    expect(validateDriverInput({}, true)).toMatch(/worker_id/)
    expect(validateDriverInput({ worker_id: '11111111-1111-1111-1111-111111111111' }, true)).toBeNull()
  })
  it('does not require a worker on patch', () => {
    expect(validateDriverInput({ license_class: 'cdl_a' }, false)).toBeNull()
  })
  it('rejects a hazmat expiry without the flag', () => {
    expect(validateDriverInput({ hazmat_endorsement: false, hazmat_endorsement_expires_at: '2026-09-01' }, false)).toMatch(/hazmat_endorsement/)
  })
  it('rejects bad date + class', () => {
    expect(validateDriverInput({ license_expires_at: '2026/01/01' }, false)).toMatch(/YYYY-MM-DD/)
    expect(validateDriverInput({ license_class: 'cdl_z' as never }, false)).toMatch(/license_class/)
  })
})

describe('buildFleetExpiryDigest', () => {
  const asOf = new Date('2026-05-24T00:00:00Z')

  it('buckets expiring vs expired and drops out-of-window', () => {
    const digests = buildFleetExpiryDigest([
      { tenant_id: 't1', kind: 'driver_license', subject: 'Ana', subject_kind: 'driver', subject_id: 'd1', expires_at: '2026-06-10' }, // expiring (17d)
      { tenant_id: 't1', kind: 'vehicle_insurance', subject: 'T-1', subject_kind: 'vehicle', subject_id: 'v1', expires_at: '2026-05-20' }, // expired 4d
      { tenant_id: 't1', kind: 'driver_medical', subject: 'Bo', subject_kind: 'driver', subject_id: 'd2', expires_at: '2026-09-01' }, // too far out — dropped
      { tenant_id: 't1', kind: 'vehicle_registration', subject: 'T-2', subject_kind: 'vehicle', subject_id: 'v2', expires_at: '2026-01-01' }, // expired long ago — dropped
      { tenant_id: 't1', kind: 'driver_hazmat', subject: 'Cy', subject_kind: 'driver', subject_id: 'd3', expires_at: null }, // no date — skipped
    ], asOf)

    expect(digests).toHaveLength(1)
    const rows = digests[0].rows
    expect(rows).toHaveLength(2)
    // expired sorts before expiring
    expect(rows[0].status).toBe('expired')
    expect(rows[0].subject).toBe('T-1')
    expect(rows[0].days).toBe(4)
    expect(rows[1].status).toBe('expiring')
    expect(rows[1].days).toBe(17)
  })

  it('groups by tenant', () => {
    const digests = buildFleetExpiryDigest([
      { tenant_id: 'a', kind: 'driver_license', subject: 'x', subject_kind: 'driver', subject_id: '1', expires_at: '2026-06-01' },
      { tenant_id: 'b', kind: 'driver_license', subject: 'y', subject_kind: 'driver', subject_id: '2', expires_at: '2026-06-01' },
    ], asOf)
    expect(digests.map(d => d.tenant_id).sort()).toEqual(['a', 'b'])
  })
})
