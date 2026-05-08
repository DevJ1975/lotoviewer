import { describe, it, expect } from 'vitest'
import {
  buildItaSubmissionPayload,
  classifyItaCoverage,
  appendixForNaics,
  type Osha300ASummary,
} from '../oshaForms'

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

describe('buildItaSubmissionPayload', () => {
  it('mirrors the 300A summary into the documented JSON shape', () => {
    const out = buildItaSubmissionPayload({
      year: 2026,
      establishment_id:     'OSHA-12345',
      establishment_name:   'Demo Plant',
      street: '1 Industrial Way', city: 'Springfield', state: 'IL', zip: '62701',
      naics_code: '311615', industry_description: 'Poultry processing',
      summary: SUMMARY,
      certified_typed_name: 'Pat Owens',
      certified_at: '2026-02-01T12:00:00Z',
    })
    expect(out.reporting_year).toBe(2026)
    expect(out.establishment_id).toBe('OSHA-12345')
    expect(out.no_injuries).toBe(false)
    expect(out.totals.days_away_cases).toBe(1)
    expect(out.totals.other_recordable_cases).toBe(1)
    expect(out.totals.days_away_days).toBe(5)
    expect(out.illness_types.injury).toBe(2)
    expect(out.certification.executive_typed_name).toBe('Pat Owens')
    expect(out.certification.certified_at).toBe('2026-02-01T12:00:00Z')
    expect(out.cases).toBeUndefined()  // include_cases defaults false
  })

  it('flags no_injuries when every count is zero', () => {
    const empty: Osha300ASummary = {
      ...SUMMARY,
      total_deaths: 0, total_days_away: 0, total_restricted: 0,
      total_other_recordable: 0,
      total_days_away_count: 0, total_days_restricted_count: 0,
      by_injury_type: {
        injury: 0, skin_disorder: 0, respiratory: 0,
        poisoning: 0, hearing_loss: 0, other_illness: 0,
      },
    }
    const out = buildItaSubmissionPayload({
      year: 2026,
      establishment_id: 'X', establishment_name: 'X',
      street: null, city: null, state: null, zip: null,
      naics_code: null, industry_description: null,
      summary: empty, certified_typed_name: null, certified_at: null,
    })
    expect(out.no_injuries).toBe(true)
    expect(out.totals.deaths).toBe(0)
  })

  it('attaches case rows when include_cases=true', () => {
    const out = buildItaSubmissionPayload({
      year: 2026,
      establishment_id: 'X', establishment_name: 'X',
      street: null, city: null, state: null, zip: null,
      naics_code: null, industry_description: null,
      summary: SUMMARY,
      certified_typed_name: null, certified_at: null,
      include_cases: true,
      cases: [{
        case_number: 'INC-1', employee_name: 'A',
        job_title: null, date_of_injury: '2026-01-01',
        location_text: null, injury_description: 'x',
        classification: 'days_away', days_away: 3, days_restricted: 0,
        injury_type: 'injury', is_privacy_case: false,
      }],
    })
    expect(out.cases?.length).toBe(1)
    expect(out.cases?.[0]?.case_number).toBe('INC-1')
  })
})

describe('classifyItaCoverage', () => {
  it('250+ employees in any industry → summary_only', () => {
    expect(classifyItaCoverage({ annual_avg_employees: 250, appendix: null })).toBe('summary_only')
    expect(classifyItaCoverage({ annual_avg_employees: 600, appendix: 'a' })).toBe('summary_only')
  })

  it('20–249 in Appendix A → summary_only', () => {
    expect(classifyItaCoverage({ annual_avg_employees: 20, appendix: 'a' })).toBe('summary_only')
    expect(classifyItaCoverage({ annual_avg_employees: 249, appendix: 'a' })).toBe('summary_only')
  })

  it('100+ in Appendix B → summary_and_cases (includes 300/301 case rows)', () => {
    expect(classifyItaCoverage({ annual_avg_employees: 100, appendix: 'b' })).toBe('summary_and_cases')
    // Appendix B tier wins over the size-only tier when both apply
    expect(classifyItaCoverage({ annual_avg_employees: 500, appendix: 'b' })).toBe('summary_and_cases')
  })

  it('outside coverage → not_required', () => {
    expect(classifyItaCoverage({ annual_avg_employees: 19, appendix: 'a' })).toBe('not_required')
    expect(classifyItaCoverage({ annual_avg_employees: 99, appendix: 'b' })).toBe('not_required')
    expect(classifyItaCoverage({ annual_avg_employees: 100, appendix: null })).toBe('not_required')
  })
})

describe('appendixForNaics', () => {
  it('returns null when code is missing or too short', () => {
    expect(appendixForNaics(null)).toBeNull()
    expect(appendixForNaics(undefined)).toBeNull()
    expect(appendixForNaics('')).toBeNull()
    expect(appendixForNaics('123')).toBeNull()
  })

  it('matches a 6-digit code by 4-digit prefix', () => {
    // Logging — appears on both Appendix A and B; B wins (stricter rule).
    expect(appendixForNaics('113310')).toBe('b')
    // 311615 (poultry processing) → 3116 → Appendix B (animal slaughter)
    expect(appendixForNaics('311615')).toBe('b')
    // 236118 (residential remodelers) → 2361 → Appendix A
    expect(appendixForNaics('236118')).toBe('a')
    // 622110 (general medical & surgical hospitals) → 6221 → on both, B wins
    expect(appendixForNaics('622110')).toBe('b')
  })

  it('strips non-digits and tolerates whitespace', () => {
    expect(appendixForNaics(' 236-118 ')).toBe('a')
  })

  it('returns null for codes outside the seeded tables (size-only path applies)', () => {
    // 541330 (Engineering Services) — not in either appendix.
    expect(appendixForNaics('541330')).toBeNull()
    // 722511 (Full-Service Restaurants) — not in either appendix.
    expect(appendixForNaics('722511')).toBeNull()
  })
})
