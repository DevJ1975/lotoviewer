import { describe, it, expect } from 'vitest'
import {
  lotoTrainingStatusTone,
  lotoTrainingStatusText,
  evaluateLotoTraining,
  type LotoTrainingStatus,
} from '@/lib/trainingRecords'

// Tests for the display helpers extracted in the devjr refactor pass.
// The shape of the LotoTrainingStatus union is the contract we're
// enforcing here — each case produces the right tone and text.

describe('lotoTrainingStatusTone', () => {
  it('current → success', () => {
    expect(lotoTrainingStatusTone({ status: 'current', expires_on: null })).toBe('success')
    expect(lotoTrainingStatusTone({ status: 'current', expires_on: '2030-01-01' })).toBe('success')
  })
  it('expiring → warn', () => {
    expect(lotoTrainingStatusTone({ status: 'expiring', expires_on: '2026-06-01', days_remaining: 5 })).toBe('warn')
  })
  it('expired → danger', () => {
    expect(lotoTrainingStatusTone({ status: 'expired', expires_on: '2026-04-01' })).toBe('danger')
  })
  it('missing → danger', () => {
    expect(lotoTrainingStatusTone({ status: 'missing' })).toBe('danger')
  })
})

describe('lotoTrainingStatusText', () => {
  it('current with no expiry surfaces "no expiry on file"', () => {
    expect(lotoTrainingStatusText({ status: 'current', expires_on: null })).toContain('no expiry on file')
  })
  it('current with expiry includes the date', () => {
    expect(lotoTrainingStatusText({ status: 'current', expires_on: '2030-01-01' })).toContain('2030-01-01')
  })
  it('expiring uses singular "day" at 1 day remaining', () => {
    const t = lotoTrainingStatusText({ status: 'expiring', expires_on: '2026-05-07', days_remaining: 1 })
    expect(t).toMatch(/in 1 day\b/)   // not "1 days"
    expect(t).not.toMatch(/in 1 days/)
  })
  it('expiring uses plural "days" at 0 / 2 / 30 days', () => {
    for (const n of [0, 2, 30]) {
      const t = lotoTrainingStatusText({ status: 'expiring', expires_on: '2026-05-07', days_remaining: n })
      expect(t, `n=${n}`).toMatch(/days/)
    }
  })
  it('expired includes the date and the renew nudge', () => {
    const t = lotoTrainingStatusText({ status: 'expired', expires_on: '2026-04-01' })
    expect(t).toContain('2026-04-01')
    expect(t).toMatch(/Renew before issuing a locktag/i)
  })
  it('missing without workerName falls back to generic phrasing', () => {
    expect(lotoTrainingStatusText({ status: 'missing' })).toMatch(/No LOTO training record on file\./)
  })
  it('missing with workerName names the worker', () => {
    expect(lotoTrainingStatusText({ status: 'missing' }, 'Maria Santos')).toContain('Maria Santos')
  })

  // ── Edge cases — special characters in worker names ─────────────────
  // These break PDF generators + email subject lines that don't
  // sanitize. Asserting the helper just returns the input verbatim
  // (let downstream sanitize per-channel).
  const specials: Array<{ name: string; reason: string }> = [
    { name: "O'Brien",                reason: 'apostrophe' },
    { name: 'Müller',                 reason: 'umlaut' },
    { name: 'Hans-Peter',             reason: 'hyphen' },
    { name: 'José María',             reason: 'multi-word + accent' },
    { name: 'Worker "Quoted"',        reason: 'double quotes' },
    { name: 'Line\nbreak',            reason: 'newline (would break email subject)' },
    { name: 'Ümlaut​zero-width', reason: 'zero-width space (homograph attack vector)' },
    { name: '   trimmed   ',          reason: 'leading/trailing whitespace' },
    { name: '中文',                   reason: 'CJK ideographs' },
  ]
  for (const c of specials) {
    it(`missing with name containing ${c.reason} preserves the input`, () => {
      const t = lotoTrainingStatusText({ status: 'missing' }, c.name)
      expect(t).toContain(c.name)
    })
  }

  it('handles very long worker name (truncation is downstream)', () => {
    const long = 'A'.repeat(500)
    const t = lotoTrainingStatusText({ status: 'missing' }, long)
    expect(t.length).toBeGreaterThan(500)
  })
})

describe('lotoTrainingStatus integration — text + tone agree', () => {
  // Sanity check: every status value the evaluator can produce maps
  // to a non-empty text and a tone. Catches a future refactor that
  // adds a new status case to the union without updating display.
  function makeStatus(kind: LotoTrainingStatus['status']): LotoTrainingStatus {
    if (kind === 'current')  return { status: 'current',  expires_on: null }
    if (kind === 'expiring') return { status: 'expiring', expires_on: '2026-05-07', days_remaining: 5 }
    if (kind === 'expired')  return { status: 'expired',  expires_on: '2026-04-01' }
    return { status: 'missing' }
  }
  const cases: LotoTrainingStatus['status'][] = ['current', 'expiring', 'expired', 'missing']
  for (const kind of cases) {
    it(`${kind} → non-empty text + valid tone`, () => {
      const s = makeStatus(kind)
      const text = lotoTrainingStatusText(s)
      const tone = lotoTrainingStatusTone(s)
      expect(text.length).toBeGreaterThan(0)
      expect(['success', 'warn', 'danger']).toContain(tone)
    })
  }

  it('evaluateLotoTraining → status feeds into both helpers without crash', () => {
    const status = evaluateLotoTraining({
      workerName: 'test',
      records:    [],
      asOf:       new Date('2026-05-06T12:00:00Z'),
    })
    expect(() => lotoTrainingStatusText(status, 'test')).not.toThrow()
    expect(() => lotoTrainingStatusTone(status)).not.toThrow()
  })
})
