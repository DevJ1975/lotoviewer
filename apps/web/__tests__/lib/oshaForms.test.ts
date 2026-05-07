import { describe, it, expect } from 'vitest'
import {
  build300Row,
  build300LogRows,
  build300ASummary,
  trirFromSummary,
  dartFromSummary,
  build301Form,
  buildItaCsvRows,
  rowsToCsv,
  csvEscape,
  OSHA_RATE_CONSTANT,
  type Osha300Row,
  type Osha300ASummary,
} from '@soteria/core/oshaForms'

const incidentBase = {
  report_number: 'INC-2026-0001',
  occurred_at:   '2026-04-12T14:30:00Z',
  description:   'Worker slipped on wet floor',
  location_text: 'Loading dock B',
}

describe('build300Row — recordability gating', () => {
  it('returns null when meets_recording_criteria=false', () => {
    expect(build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: false, classification: null, is_privacy_case: false },
      person: null,
      care:   null,
    })).toBeNull()
  })

  it('returns null when classification is null', () => {
    expect(build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: true, classification: null, is_privacy_case: false },
      person: null,
      care:   null,
    })).toBeNull()
  })

  it('shapes a recordable days_away row', () => {
    const r = build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: true, classification: 'days_away', is_privacy_case: false },
      person: { full_name: 'Alex Chen', job_title: 'Forklift operator' },
      care:   { days_away_from_work: 5, days_restricted: 0 },
    })
    expect(r).not.toBeNull()
    expect(r!.case_number).toBe('INC-2026-0001')
    expect(r!.employee_name).toBe('Alex Chen')
    expect(r!.classification).toBe('days_away')
    expect(r!.days_away).toBe(5)
    expect(r!.days_restricted).toBe(0)
  })
})

describe('build300Row — privacy-case redaction (1904.29(b)(7))', () => {
  it('redacts name + location to "Privacy Case" / null', () => {
    const r = build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: true, classification: 'other_recordable', is_privacy_case: true },
      person: { full_name: 'Should Not Appear', job_title: 'Should Not Appear' },
      care:   null,
    })
    expect(r!.employee_name).toBe('Privacy Case')
    expect(r!.job_title).toBeNull()
    expect(r!.location_text).toBeNull()
    expect(r!.is_privacy_case).toBe(true)
  })
})

describe('build300Row — day-counter capping at 180 (1904.7(b)(3)(viii))', () => {
  it('caps days_away at 180', () => {
    const r = build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: true, classification: 'days_away', is_privacy_case: false },
      person: { full_name: 'A B', job_title: null },
      care:   { days_away_from_work: 365, days_restricted: 0 },
    })
    expect(r!.days_away).toBe(180)
  })

  it('caps days_restricted at 180', () => {
    const r = build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: true, classification: 'restricted', is_privacy_case: false },
      person: { full_name: 'A B', job_title: null },
      care:   { days_away_from_work: 0, days_restricted: 250 },
    })
    expect(r!.days_restricted).toBe(180)
  })

  it('zeroes the column that doesn\'t apply to the classification', () => {
    // A "restricted" case must not carry days_away on the form.
    const r = build300Row({
      incident: incidentBase,
      classification: { meets_recording_criteria: true, classification: 'restricted', is_privacy_case: false },
      person: { full_name: 'A B', job_title: null },
      care:   { days_away_from_work: 9, days_restricted: 4 },
    })
    expect(r!.days_away).toBe(0)
    expect(r!.days_restricted).toBe(4)
  })
})

describe('build300LogRows', () => {
  it('drops not-recordable items and keeps the rest', () => {
    const rows = build300LogRows([
      {
        incident: incidentBase,
        classification: { meets_recording_criteria: false, classification: null, is_privacy_case: false },
        person: null, care: null,
      },
      {
        incident: { ...incidentBase, report_number: 'INC-2026-0002' },
        classification: { meets_recording_criteria: true, classification: 'days_away', is_privacy_case: false },
        person: { full_name: 'Alex', job_title: 'Welder' },
        care:   { days_away_from_work: 2, days_restricted: 0 },
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]!.case_number).toBe('INC-2026-0002')
  })
})

describe('build300ASummary', () => {
  function row(over: Partial<Osha300Row> = {}): Osha300Row {
    return {
      case_number:        'INC-X',
      employee_name:      'A B',
      job_title:          null,
      date_of_injury:     '2026-04-01',
      location_text:      null,
      injury_description: null,
      classification:     'other_recordable',
      days_away:          0,
      days_restricted:    0,
      injury_type:        'injury',
      is_privacy_case:    false,
      ...over,
    }
  }

  it('aggregates classification counts correctly', () => {
    const s = build300ASummary({
      year: 2026,
      total_hours_worked:   200_000,
      annual_avg_employees: 100,
      rows: [
        row({ classification: 'death' }),
        row({ classification: 'days_away',        days_away: 5 }),
        row({ classification: 'days_away',        days_away: 7 }),
        row({ classification: 'restricted',       days_restricted: 3 }),
        row({ classification: 'other_recordable' }),
      ],
    })
    expect(s.total_deaths).toBe(1)
    expect(s.total_days_away).toBe(2)
    expect(s.total_restricted).toBe(1)
    expect(s.total_other_recordable).toBe(1)
    expect(s.total_days_away_count).toBe(12)
    expect(s.total_days_restricted_count).toBe(3)
  })

  it('groups by injury type', () => {
    const s = build300ASummary({
      year: 2026, total_hours_worked: 1, annual_avg_employees: 1,
      rows: [
        row({ injury_type: 'injury' }),
        row({ injury_type: 'injury' }),
        row({ injury_type: 'skin_disorder' }),
        row({ injury_type: 'hearing_loss' }),
      ],
    })
    expect(s.by_injury_type.injury).toBe(2)
    expect(s.by_injury_type.skin_disorder).toBe(1)
    expect(s.by_injury_type.hearing_loss).toBe(1)
    expect(s.by_injury_type.respiratory).toBe(0)
  })

  it('passes through hours/employees inputs unchanged', () => {
    const s = build300ASummary({
      year: 2026, rows: [],
      total_hours_worked: 482_310, annual_avg_employees: 47,
    })
    expect(s.total_hours_worked).toBe(482_310)
    expect(s.annual_avg_employees).toBe(47)
  })
})

describe('rate helpers', () => {
  function s(over: Partial<Osha300ASummary> = {}): Osha300ASummary {
    return {
      year: 2026,
      total_deaths: 0, total_days_away: 0, total_restricted: 0, total_other_recordable: 0,
      total_days_away_count: 0, total_days_restricted_count: 0,
      by_injury_type: { injury: 0, skin_disorder: 0, respiratory: 0, poisoning: 0, hearing_loss: 0, other_illness: 0 },
      total_hours_worked: 200_000, annual_avg_employees: 100,
      ...over,
    }
  }

  it('TRIR uses the 200,000 constant', () => {
    const out = trirFromSummary(s({ total_days_away: 1, total_hours_worked: 200_000 }))
    expect(OSHA_RATE_CONSTANT).toBe(200_000)
    expect(out).toBe(1.0)
  })

  it('TRIR sums all classifications', () => {
    const out = trirFromSummary(s({
      total_deaths: 1, total_days_away: 1, total_restricted: 1, total_other_recordable: 1,
      total_hours_worked: 200_000,
    }))
    expect(out).toBe(4.0)
  })

  it('DART excludes other_recordable', () => {
    const out = dartFromSummary(s({
      total_deaths: 1, total_days_away: 1, total_restricted: 1, total_other_recordable: 5,
      total_hours_worked: 200_000,
    }))
    expect(out).toBe(3.0)
  })

  it('returns null on zero hours (avoid NaN)', () => {
    expect(trirFromSummary(s({ total_hours_worked: 0 }))).toBeNull()
    expect(dartFromSummary(s({ total_hours_worked: 0 }))).toBeNull()
  })
})

describe('build301Form', () => {
  it('flattens incident + person + care into the 301 shape', () => {
    const f = build301Form({
      incident: incidentBase,
      person: {
        full_name: 'Alex Chen', job_title: 'Welder',
        home_address: '123 Main St', date_of_birth: '1985-06-12', hire_date: '2020-01-15',
        gender: 'male', body_part: ['hand_right'], injury_nature: 'laceration',
        injury_source: 'sheet metal', treatment_facility: null,
      },
      care:    { treating_physician: 'Dr Smith', clinic_name: 'Acme Clinic' },
      preparer: { name: 'Lead', title: 'Safety officer', phone: '555-0100' },
      classification: { classification: 'other_recordable' },
    })
    expect(f.case_number).toBe('INC-2026-0001')
    expect(f.employee_full_name).toBe('Alex Chen')
    expect(f.employee_address).toBe('123 Main St')
    expect(f.injury_or_illness).toBe('hand_right — laceration')
    expect(f.what_object_substance).toBe('sheet metal')
    expect(f.treating_physician).toBe('Dr Smith')
    expect(f.treatment_facility).toBe('Acme Clinic')
    expect(f.date_of_death).toBeNull()
  })

  it('sets date_of_death when classification is death', () => {
    const f = build301Form({
      incident: incidentBase,
      person: null, care: null, preparer: null,
      classification: { classification: 'death' },
    })
    expect(f.date_of_death).toBe('2026-04-12')
  })
})

describe('csvEscape + rowsToCsv', () => {
  it('escapes commas, quotes, and newlines', () => {
    expect(csvEscape('plain')).toBe('plain')
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('she said "hi"')).toBe('"she said ""hi"""')
    expect(csvEscape('line\nbreak')).toBe('"line\nbreak"')
  })

  it('writes a CSV with header row + data rows', () => {
    const csv = rowsToCsv([
      ['name', 'count'],
      ['Alpha, Inc.', '10'],
      ['Beta', '0'],
    ])
    expect(csv).toBe('name,count\n"Alpha, Inc.",10\nBeta,0\n')
  })
})

describe('buildItaCsvRows', () => {
  it('emits header + one row per establishment', () => {
    const rows = buildItaCsvRows([{
      name: 'Plant A', internal_id: 'uuid-1',
      street: '1 Industrial Way', city: 'Springfield', state: 'IL', zip: '62701',
      naics_code: '311615', industry_description: 'Poultry processing',
      summary: {
        year: 2026,
        total_deaths: 0, total_days_away: 2, total_restricted: 1, total_other_recordable: 1,
        total_days_away_count: 14, total_days_restricted_count: 5,
        by_injury_type: { injury: 3, skin_disorder: 1, respiratory: 0, poisoning: 0, hearing_loss: 0, other_illness: 0 },
        total_hours_worked: 482_310, annual_avg_employees: 47,
      },
    }])
    expect(rows).toHaveLength(2)
    // Header row exists + has the documented columns.
    expect(rows[0]).toContain('establishment_name')
    expect(rows[0]).toContain('naics_code')
    // Data row carries the establishment + counts.
    expect(rows[1]).toContain('Plant A')
    expect(rows[1]).toContain('311615')
    // no_injuries flag = 0 because we have recordables.
    const noInjuriesIdx = rows[0]!.indexOf('no_injuries')
    expect(rows[1]![noInjuriesIdx]).toBe('0')
  })

  it('flags no_injuries=1 when zero recordables', () => {
    const rows = buildItaCsvRows([{
      name: 'Office HQ', internal_id: 'uuid-2',
      street: null, city: null, state: null, zip: null,
      naics_code: null, industry_description: null,
      summary: {
        year: 2026,
        total_deaths: 0, total_days_away: 0, total_restricted: 0, total_other_recordable: 0,
        total_days_away_count: 0, total_days_restricted_count: 0,
        by_injury_type: { injury: 0, skin_disorder: 0, respiratory: 0, poisoning: 0, hearing_loss: 0, other_illness: 0 },
        total_hours_worked: 100_000, annual_avg_employees: 50,
      },
    }])
    const noInjuriesIdx = rows[0]!.indexOf('no_injuries')
    expect(rows[1]![noInjuriesIdx]).toBe('1')
  })
})
