import { describe, it, expect } from 'vitest'
import {
  validateBugReport,
  isValidSeverity,
  renderBugReportText,
  SEVERITY_LABELS,
  type BugReportPayload,
} from '@/lib/bugReport'

function payload(p: Partial<BugReportPayload>): BugReportPayload {
  return {
    title:       'Equipment list never loads on iPad',
    description: 'When I open the LOTO module, the list spins forever.',
    severity:    'high',
    ...p,
  }
}

// ── validateBugReport ─────────────────────────────────────────────────────

describe('validateBugReport', () => {
  it('accepts a well-formed report', () => {
    expect(validateBugReport(payload({}))).toEqual([])
  })

  it('rejects a missing title', () => {
    expect(validateBugReport(payload({ title: '' }))).toContain('Title is required.')
    expect(validateBugReport(payload({ title: '   ' }))).toContain('Title is required.')
  })

  it('rejects an oversized title', () => {
    const errs = validateBugReport(payload({ title: 'x'.repeat(201) }))
    expect(errs.some(e => e.includes('200 characters'))).toBe(true)
  })

  it('rejects a missing description', () => {
    expect(validateBugReport(payload({ description: '' }))).toContain('Description is required.')
  })

  it('rejects a too-short description (less than 10 chars)', () => {
    const errs = validateBugReport(payload({ description: 'short' }))
    expect(errs.some(e => e.includes('sentence'))).toBe(true)
  })

  it('rejects a description over 10k chars (anti-DoS)', () => {
    const errs = validateBugReport(payload({ description: 'x'.repeat(10_001) }))
    expect(errs.some(e => e.includes('too long'))).toBe(true)
  })

  it('rejects an unrecognized severity (anti-spoof)', () => {
    const errs = validateBugReport({
      ...payload({}),
      severity: 'panic' as unknown as 'low',
    })
    expect(errs.some(e => e.includes('Severity'))).toBe(true)
  })

  it('combines multiple errors', () => {
    const errs = validateBugReport({ title: '', description: '' })
    expect(errs.length).toBeGreaterThanOrEqual(2)
  })

  it('treats whitespace-only as effectively empty', () => {
    const errs = validateBugReport({ title: '   ', description: '   ' })
    expect(errs).toContain('Title is required.')
    expect(errs).toContain('Description is required.')
  })
})

// ── isValidSeverity ───────────────────────────────────────────────────────

describe('isValidSeverity', () => {
  it('accepts all four documented severities', () => {
    for (const s of ['low', 'medium', 'high', 'critical']) {
      expect(isValidSeverity(s)).toBe(true)
    }
  })

  it('rejects null / undefined / empty / unknown', () => {
    expect(isValidSeverity(null)).toBe(false)
    expect(isValidSeverity(undefined)).toBe(false)
    expect(isValidSeverity('')).toBe(false)
    expect(isValidSeverity('panic')).toBe(false)
    expect(isValidSeverity(2)).toBe(false)
  })
})

// ── SEVERITY_LABELS — sanity check on the surface UI uses ─────────────────

describe('SEVERITY_LABELS', () => {
  it('has a non-empty label for every severity', () => {
    for (const k of ['low', 'medium', 'high', 'critical'] as const) {
      expect(SEVERITY_LABELS[k]).toBeTruthy()
      expect(SEVERITY_LABELS[k].length).toBeGreaterThan(0)
    }
  })

  it('marks "critical" with safety / compliance language so the dropdown communicates impact', () => {
    expect(SEVERITY_LABELS.critical.toLowerCase()).toMatch(/safety|compliance/)
  })
})

// ── renderBugReportText ───────────────────────────────────────────────────

describe('renderBugReportText', () => {
  it('renders the core payload fields', () => {
    const out = renderBugReportText({
      payload:        payload({}),
      reporter_email: 'jamil@trainovations.com',
      reporter_name:  'Jamil',
      submitted_at:   '2026-04-26T12:00:00Z',
    })
    expect(out).toContain('Equipment list never loads on iPad')
    expect(out).toContain('Severity: high')
    expect(out).toContain('Jamil')
    expect(out).toContain('jamil@trainovations.com')
    expect(out).toContain('2026-04-26T12:00:00Z')
  })

  it('omits the steps section when no steps are provided', () => {
    const out = renderBugReportText({
      payload:        payload({}),
      reporter_email: 'jamil@trainovations.com',
      reporter_name:  null,
      submitted_at:   '2026-04-26T12:00:00Z',
    })
    expect(out).not.toContain('Steps to reproduce')
  })

  it('includes the steps section when provided', () => {
    const out = renderBugReportText({
      payload:        payload({ steps: '1. Open LOTO\n2. Wait\n3. Spinner forever' }),
      reporter_email: 'a@b.com',
      reporter_name:  'A',
      submitted_at:   '2026-04-26T12:00:00Z',
    })
    expect(out).toContain('Steps to reproduce')
    expect(out).toContain('Spinner forever')
  })

  it('falls back gracefully when reporter is unknown (e.g. session lost mid-submit)', () => {
    const out = renderBugReportText({
      payload:        payload({}),
      reporter_email: null,
      reporter_name:  null,
      submitted_at:   '2026-04-26T12:00:00Z',
    })
    expect(out).toContain('(unknown)')
    expect(out).toContain('unknown')   // email fallback
  })

  it('includes page_url + user_agent when present', () => {
    const out = renderBugReportText({
      payload:        payload({
        page_url:   'https://soteria/loto?eq=EQ-001',
        user_agent: 'Mozilla/5.0 (iPad)',
      }),
      reporter_email: 'a@b.com',
      reporter_name:  'A',
      submitted_at:   '2026-04-26T12:00:00Z',
    })
    expect(out).toContain('Page URL: https://soteria/loto?eq=EQ-001')
    expect(out).toContain('User agent: Mozilla/5.0 (iPad)')
  })
})
