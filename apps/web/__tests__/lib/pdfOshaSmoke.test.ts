import { describe, it, expect } from 'vitest'
import { renderOsha300Pdf } from '@/lib/pdfOsha300'
import { renderOsha300APdf } from '@/lib/pdfOsha300A'
import { renderOsha301Pdf } from '@/lib/pdfOsha301'
import { type Osha300Row, type Osha300ASummary, type Osha301Form } from '@soteria/core/oshaForms'

// Smoke tests for the OSHA PDF generators after the SoteriaField
// brand-mark wiring (drawBrandMark in pdfShared). These don't try
// to validate visual fidelity — they confirm the renderers don't
// throw, produce a non-empty Uint8Array, and the output starts with
// the PDF magic number `%PDF-`. A future iteration could rasterise
// + compare pixel hashes; for now this catches the obvious crashes
// (font-not-embedded, NaN coordinates, etc.) the brand-mark math
// could introduce.

const ROW: Osha300Row = {
  case_number:        'INC-2026-0001',
  employee_name:      'Riley Demo',
  job_title:          'Forklift operator',
  date_of_injury:     '2026-04-12',
  location_text:      'Production Line 3',
  injury_description: 'Slipped on hydraulic oil; right knee sprain.',
  classification:     'days_away',
  days_away:          5,
  days_restricted:    0,
  injury_type:        'injury',
  is_privacy_case:    false,
}

const PRIVACY_ROW: Osha300Row = {
  ...ROW,
  case_number:        'INC-2026-0002',
  employee_name:      'Privacy Case',
  job_title:          null,
  location_text:      null,
  classification:     'other_recordable',
  is_privacy_case:    true,
}

const SUMMARY: Osha300ASummary = {
  year: 2026,
  total_deaths: 0,
  total_days_away: 1,
  total_restricted: 0,
  total_other_recordable: 1,
  total_days_away_count: 5,
  total_days_restricted_count: 0,
  by_injury_type: {
    injury: 2, skin_disorder: 0, respiratory: 0,
    poisoning: 0, hearing_loss: 0, other_illness: 0,
  },
  total_hours_worked: 96720,
  annual_avg_employees: 47,
}

function isPdf(bytes: Uint8Array): boolean {
  // %PDF- = 0x25 0x50 0x44 0x46 0x2D
  return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44
      && bytes[3] === 0x46 && bytes[4] === 0x2D
}

describe('renderOsha300Pdf — brand mark smoke', () => {
  it('renders a 300 log with one row + one privacy-case row', async () => {
    const bytes = await renderOsha300Pdf({
      rows: [ROW, PRIVACY_ROW],
      establishmentName: 'Demo Plant — Springfield',
      city: 'Springfield', state: 'IL',
      year: 2026,
    })
    expect(bytes.byteLength).toBeGreaterThan(2000)
    expect(isPdf(bytes)).toBe(true)
  })

  it('renders an empty 300 log without crashing', async () => {
    const bytes = await renderOsha300Pdf({
      rows: [],
      establishmentName: 'Empty Plant', city: null, state: null,
      year: 2026,
    })
    expect(isPdf(bytes)).toBe(true)
  })

  it('paginates a 50-row log across multiple pages', async () => {
    const rows = Array.from({ length: 50 }, (_, i) => ({ ...ROW, case_number: `INC-${i}` }))
    const bytes = await renderOsha300Pdf({
      rows,
      establishmentName: 'Big Plant', city: null, state: null,
      year: 2026,
    })
    expect(isPdf(bytes)).toBe(true)
    // 50 rows / ~16 per page ≈ 4 pages; bytes should grow with rows
    expect(bytes.byteLength).toBeGreaterThan(8000)
  })
})

describe('renderOsha300APdf — brand mark smoke', () => {
  it('renders a 300A summary', async () => {
    const bytes = await renderOsha300APdf({
      summary: SUMMARY,
      establishment: {
        name: 'Demo Plant — Springfield',
        street: '1 Industrial Way', city: 'Springfield',
        state: 'IL', zip: '62701', naics_code: '311615',
        certifying_executive_name: 'Pat Owens',
        certifying_executive_title: 'VP Operations',
        is_partial_year: false,
      },
    })
    expect(isPdf(bytes)).toBe(true)
    expect(bytes.byteLength).toBeGreaterThan(2000)
  })

  it('renders a certified 300A with signer name', async () => {
    const bytes = await renderOsha300APdf({
      summary: SUMMARY,
      establishment: {
        name: 'Plant', street: null, city: null, state: null, zip: null,
        naics_code: null,
        certifying_executive_name: null, certifying_executive_title: null,
        is_partial_year: true,
      },
      certified_by_name: 'Pat Owens',
      certified_at: '2026-02-01T00:00:00Z',
    })
    expect(isPdf(bytes)).toBe(true)
  })
})

describe('renderOsha301Pdf — brand mark smoke', () => {
  const FORM: Osha301Form = {
    report_number: 'INC-2026-0001',
    date_of_injury: '2026-04-12',
    time_of_event: '14:30',
    case_number: 'INC-2026-0001',
    employee_full_name: 'Riley Demo',
    employee_address: '123 Main St',
    employee_dob: '1985-06-12',
    employee_hired_at: '2020-01-15',
    employee_gender: 'female',
    employee_job_title: 'Forklift operator',
    treating_physician: 'Dr. Lena Park',
    treatment_facility: 'Springfield Occ-Med Clinic',
    treated_in_emergency_room: false,
    hospitalised_overnight: false,
    what_was_employee_doing: 'Loading pallets',
    what_happened: 'Slipped on hydraulic oil',
    injury_or_illness: 'knee_right — sprain',
    what_object_substance: 'wet floor / hydraulic fluid',
    date_of_death: null,
    prepared_by_name: 'Pat Owens',
    prepared_by_title: 'Safety officer',
    prepared_by_phone: '555-0100',
    prepared_at: '2026-04-12T15:00:00Z',
  }

  it('renders a 301 form with all fields populated', async () => {
    const bytes = await renderOsha301Pdf({ form: FORM, establishmentName: 'Demo Plant' })
    expect(isPdf(bytes)).toBe(true)
    expect(bytes.byteLength).toBeGreaterThan(2000)
  })

  it('renders a 301 with mostly null fields', async () => {
    const sparse: Osha301Form = {
      ...FORM,
      employee_address: null, employee_dob: null, employee_hired_at: null,
      employee_gender: null, treating_physician: null, treatment_facility: null,
      what_was_employee_doing: null, injury_or_illness: null, what_object_substance: null,
      prepared_by_name: null, prepared_by_title: null, prepared_by_phone: null,
    }
    const bytes = await renderOsha301Pdf({ form: sparse, establishmentName: null })
    expect(isPdf(bytes)).toBe(true)
  })

  it('handles unicode + special chars in narrative fields (WinAnsi sanitiser)', async () => {
    const tricky: Osha301Form = {
      ...FORM,
      what_happened: 'O₂ deficient atmosphere — 12% vs 20.9% baseline; "smart quotes" + em—dash',
      injury_or_illness: 'eye_left — H₂S exposure',
    }
    const bytes = await renderOsha301Pdf({ form: tricky, establishmentName: 'Plant' })
    expect(isPdf(bytes)).toBe(true)
  })
})
