import { describe, it, expect } from 'vitest'
import {
  evaluateResult, exceedanceSummary, judgeResult, type MonitoringLimit, type MonitoringResult,
} from '@soteria/core/environmental/monitoring'
import { DEFAULT_LIMITS } from '@soteria/core/environmental/monitoringDefaults'
import {
  appliesToText, basisLabel, blankLimitForm, blankResultForm, buildLimitRequest, buildResultRequest, defaultChoices, effectiveText,
  exceedanceCards, formatAmount, judgmentLines, limitProvenance, limitStanding, limitText, limitToForm, outfallName, parameterChoices,
  permitChoicesForLimit, resultToForm, resultValueText, sampledAtText, toLocalInput, unitSuggestion, verdictChip,
  LIMIT_BASIS_CHOICES, LIMIT_KIND_CHOICES,
} from '@/lib/environmental/monitoringView'

const SITE = 'site-1'
const OF1 = 'o-1'
const OF2 = 'o-2'

let n = 0
const limit = (over: Partial<MonitoringLimit> = {}): MonitoringLimit => ({
  id: `l-${++n}`, facilityId: SITE, outfallId: null, permitId: null, parameter: 'TSS', unit: 'mg/L', kind: 'instantaneous_max', value: 100,
  basis: 'benchmark', citation: null, verify: null, effectiveFrom: null, effectiveTo: null, source: 'tenant', libraryKey: null, ...over,
})
const result = (over: Partial<MonitoringResult> = {}): MonitoringResult => ({
  id: `r-${++n}`, facilityId: SITE, outfallId: OF1, parameter: 'TSS', unit: 'mg/L', value: 50, belowDetection: false,
  sampledAt: '2026-02-03T10:00:00Z', eventLabel: null, lab: null, evidenceId: null, note: null, sampledBy: null, ...over,
})

describe('formatAmount', () => {
  it('keeps six significant digits and drops floating point tails and trailing zeros', () => {
    expect(formatAmount(0.1 + 0.2)).toBe('0.3')
    expect(formatAmount(100)).toBe('100')
    expect(formatAmount(12.3456789)).toBe('12.3457')
    expect(formatAmount(6.0)).toBe('6')
    expect(formatAmount(0)).toBe('0')
  })
})

describe('sampledAtText and resultValueText', () => {
  it('shows the instant in UTC to the minute, the clock the reporting year is counted on', () => {
    expect(sampledAtText('2026-02-03T10:30:45.123Z')).toBe('2026-02-03 10:30 UTC')
    expect(sampledAtText('2026-02-03T10:30:00-08:00')).toBe('2026-02-03 18:30 UTC')
    expect(sampledAtText('2026-02-03T10:30:00+00:00')).toBe('2026-02-03 10:30 UTC')
  })

  it('shows what it was given when it is not a time, rather than "Invalid Date"', () => {
    expect(sampledAtText('soon')).toBe('soon')
  })

  it('shows a non-detect as below its reporting limit, not as a measurement', () => {
    expect(resultValueText({ value: 5, unit: 'mg/L', belowDetection: true })).toBe('Not detected (< 5 mg/L)')
    expect(resultValueText({ value: 5, unit: 'mg/L', belowDetection: false })).toBe('5 mg/L')
  })
})

describe('limitText and what a limit is called', () => {
  it('reads a sample limit as its bound, a maximum or a minimum', () => {
    expect(limitText(limit({ value: 400 }))).toBe('≤ 400 mg/L')
    expect(limitText(limit({ kind: 'instantaneous_min', value: 6, unit: 's.u.' }))).toBe('≥ 6 s.u.')
  })

  it('names the span for a limit judged over a day, a month or a year', () => {
    expect(limitText(limit({ kind: 'annual_average', value: 100 }))).toBe('Annual average ≤ 100 mg/L')
    expect(limitText(limit({ kind: 'daily_max', value: 5 }))).toBe('Daily maximum ≤ 5 mg/L')
    expect(limitText(limit({ kind: 'monthly_average', value: 5 }))).toBe('Monthly average ≤ 5 mg/L')
  })

  it('says what kind of limit it is, and that a library limit is a draft default', () => {
    expect(basisLabel('numeric_action_level')).toBe('Numeric action level')
    expect(limitProvenance(limit({ basis: 'permit_limit' }))).toBe('Permit limit')
    expect(limitProvenance(limit({ basis: 'benchmark', source: 'library' }))).toBe('Benchmark (draft default)')
  })

  it('says where it applies, and names a site-level sample', () => {
    const outfalls = [{ id: OF1, code: 'OF-001' }]
    expect(appliesToText(limit({ outfallId: null }), outfalls)).toBe('Whole site')
    expect(appliesToText(limit({ outfallId: OF1 }), outfalls)).toBe('OF-001')
    expect(appliesToText(limit({ outfallId: 'gone' }), outfalls)).toBe('Unknown outfall')
    expect(outfallName(null, outfalls)).toBe('Site-level')
    expect(outfallName(OF1, outfalls)).toBe('OF-001')
  })

  it('says when it is in force, or nothing if always', () => {
    expect(effectiveText({ effectiveFrom: null, effectiveTo: null })).toBeNull()
    expect(effectiveText({ effectiveFrom: '2026-07-01', effectiveTo: null })).toBe('From 2026-07-01')
    expect(effectiveText({ effectiveFrom: null, effectiveTo: '2027-06-30' })).toBe('Until 2027-06-30')
    expect(effectiveText({ effectiveFrom: '2026-07-01', effectiveTo: '2027-06-30' })).toBe('2026-07-01 to 2027-06-30')
  })
})

describe('verdictChip: a permit limit and a benchmark never share a label or a colour', () => {
  it('names an exceedance for the basis of the limit exceeded', () => {
    expect(verdictChip('exceeds', 'permit_limit')).toEqual({ tone: 'bad', label: 'Exceeds permit limit' })
    expect(verdictChip('exceeds', 'local_limit')).toEqual({ tone: 'bad', label: 'Exceeds local limit' })
    expect(verdictChip('exceeds', 'benchmark')).toEqual({ tone: 'warn', label: 'Exceeds benchmark' })
    expect(verdictChip('exceeds', 'numeric_action_level')).toEqual({ tone: 'warn', label: 'Exceeds numeric action level' })
    expect(verdictChip('exceeds', 'self_imposed')).toEqual({ tone: 'idle', label: 'Outside internal target' })
  })

  it('gives every basis its own exceedance label', () => {
    const bases = ['permit_limit', 'local_limit', 'benchmark', 'numeric_action_level', 'self_imposed'] as const
    expect(new Set(bases.map(b => verdictChip('exceeds', b).label)).size).toBe(bases.length)
    expect(verdictChip('exceeds', 'benchmark').tone).not.toBe(verdictChip('exceeds', 'permit_limit').tone)
  })

  it('reads the other statuses the same for any basis', () => {
    expect(verdictChip('within', 'benchmark')).toEqual({ tone: 'good', label: 'Within' })
    expect(verdictChip('not_evaluable', 'permit_limit')).toEqual({ tone: 'idle', label: 'Not evaluable' })
    expect(verdictChip('no_data', 'permit_limit')).toEqual({ tone: 'idle', label: 'No data' })
  })
})

describe('judgmentLines', () => {
  it('lists each limit a result was judged against: the verdict, the bound and the kind of limit', () => {
    const limits = [
      limit({ id: 'permit', basis: 'permit_limit', value: 150 }),
      limit({ id: 'benchmark', basis: 'benchmark', value: 100, source: 'library' }),
    ]
    const lines = judgmentLines(judgeResult(limits, result({ value: 120 })))
    expect(lines).toEqual([
      { key: 'permit',    chip: { tone: 'good', label: 'Within' },                limit: '≤ 150 mg/L · Permit limit',               reason: null },
      { key: 'benchmark', chip: { tone: 'warn', label: 'Exceeds benchmark' },     limit: '≤ 100 mg/L · Benchmark (draft default)', reason: null },
    ])
  })

  it('carries why a result could not be judged', () => {
    const [line] = judgmentLines(judgeResult([limit()], result({ unit: 'NTU' })))
    expect(line?.chip.label).toBe('Not evaluable')
    expect(line?.reason).toMatch(/Unit mismatch/)
  })

  it('has nothing for a result no limit applies to', () => {
    expect(judgmentLines(judgeResult([limit({ parameter: 'Zinc' })], result()))).toEqual([])
  })

  it('agrees with the evaluator on the verdict', () => {
    const l = limit({ value: 100 })
    for (const value of [50, 100, 100.01]) {
      const chip = judgmentLines([{ limit: l, evaluation: evaluateResult(l, result({ value })) }])[0]!.chip
      expect(chip.label).toBe(value > 100 ? 'Exceeds benchmark' : 'Within')
    }
  })
})

describe('limitStanding', () => {
  const NOW = Date.parse('2026-03-15T00:00:00Z')
  const standing = (limits: MonitoringLimit[], results: MonitoringResult[], limitId: string) => {
    const summary = exceedanceSummary(limits, results, NOW, { reportingYearStartMonth: 1 })
    return limitStanding(limits.find(l => l.id === limitId)!, summary.rows)
  }

  it('takes the worst outfall for a site-wide limit and adds up its exceedances and samples', () => {
    const site = limit({ id: 'site', basis: 'permit_limit', value: 100 })
    const got = standing([site], [
      result({ outfallId: OF1, value: 50 }),
      result({ outfallId: OF2, value: 500 }),
      result({ outfallId: OF2, value: 600, sampledAt: '2026-02-04T10:00:00Z' }),
    ], 'site')
    expect(got).toEqual({ chip: { tone: 'bad', label: 'Exceeds permit limit' }, exceedanceCount: 2, sampleCount: 3 })
  })

  it('is within when every outfall is, and no data when there is nothing yet', () => {
    const site = limit({ id: 'site' })
    expect(standing([site], [result({ value: 10 })], 'site')?.chip.label).toBe('Within')
    expect(standing([site], [], 'site')).toEqual({ chip: { tone: 'idle', label: 'No data' }, exceedanceCount: 0, sampleCount: 0 })
  })

  it('has no standing for a limit the summary does not list', () => {
    expect(limitStanding(limit({ id: 'ghost' }), [])).toBeNull()
  })
})

describe('exceedanceCards', () => {
  it('is two cards, a limit class and a benchmark class, each with its own count and explanation', () => {
    const cards = exceedanceCards({ limit: 2, action: 5, internal: 0 })
    expect(cards.map(c => [c.exceedanceClass, c.label, c.count])).toEqual([
      ['limit', 'Permit and local limit exceedances', 2],
      ['action', 'Benchmark and action level exceedances', 5],
    ])
    expect(cards[1]!.explanation).toMatch(/not violations of the permit/)
  })

  it('adds internal targets only when one was missed', () => {
    expect(exceedanceCards({ limit: 0, action: 0, internal: 1 }).map(c => c.exceedanceClass)).toEqual(['limit', 'action', 'internal'])
  })

  it('never makes one card of several classes', () => {
    const cards = exceedanceCards({ limit: 3, action: 4, internal: 5 })
    expect(cards.map(c => c.count)).toEqual([3, 4, 5])
  })
})

describe('choices', () => {
  it('suggests each parameter once, in the limits\' spelling, sorted', () => {
    const limits = [{ parameter: 'TSS' }, { parameter: 'Oil & grease' }, { parameter: 'pH' }]
    const results = [{ parameter: 'tss' }, { parameter: 'Zinc' }, { parameter: ' oil &  GREASE' }, { parameter: 'Copper' }]
    expect(parameterChoices(limits, results)).toEqual(['Copper', 'Oil & grease', 'pH', 'TSS', 'Zinc'])
  })

  it('suggests the unit the site\'s limits use for a parameter, however it is typed', () => {
    const limits = [{ parameter: 'pH', unit: 's.u.' }, { parameter: 'TSS', unit: 'mg/L' }]
    expect(unitSuggestion(limits, ' tss ')).toBe('mg/L')
    expect(unitSuggestion(limits, 'Zinc')).toBeNull()
  })

  it('offers the permits in force at the site, and the one the limit names even if retired', () => {
    const permit = (id: string, over: Record<string, unknown> = {}) => ({ id, facility_id: SITE, title: id, permit_number: null, retired_at: null, ...over })
    const permits = [permit('in-force'), permit('retired-linked', { retired_at: '2026-01-01' }), permit('retired-other', { retired_at: '2026-01-01' }), permit('elsewhere', { facility_id: 'site-2' })]
    expect(permitChoicesForLimit(permits, SITE, null).map(p => p.id)).toEqual(['in-force'])
    expect(permitChoicesForLimit(permits, SITE, 'retired-linked').map(p => p.id)).toEqual(['in-force', 'retired-linked'])
  })

  it('marks a default as adopted only for the place it was adopted', () => {
    const [first, second] = DEFAULT_LIMITS.filter(d => d.generalPermit === 'ca_igp')
    const adopted = limit({ libraryKey: first!.libraryKey, source: 'library', outfallId: null })
    expect(defaultChoices([first!, second!], [adopted], null).map(c => c.adopted)).toEqual([true, false])
    expect(defaultChoices([first!, second!], [adopted], OF1).map(c => c.adopted)).toEqual([false, false])
  })

  it('offers every kind and basis there is, labelled', () => {
    expect(LIMIT_KIND_CHOICES.map(c => c.value)).toEqual(['instantaneous_max', 'instantaneous_min', 'daily_max', 'monthly_average', 'annual_average'])
    expect(LIMIT_BASIS_CHOICES.map(c => c.label)).toEqual(['Permit limit', 'Benchmark', 'Numeric action level', 'Local limit', 'Internal target'])
  })
})

describe('the result form', () => {
  const at = new Date(2026, 1, 3, 10, 30)   // local time: the form speaks the sampler's clock

  it('writes an instant as a datetime-local value on the computer\'s clock', () => {
    expect(toLocalInput(at.getTime())).toBe('2026-02-03T10:30')
    expect(toLocalInput(new Date(2026, 11, 9, 5, 7).getTime())).toBe('2026-12-09T05:07')
  })

  it('starts at the moment it is opened, with nothing else filled in', () => {
    expect(blankResultForm(at.getTime())).toEqual({
      outfallId: '', parameter: '', value: '', unit: '', belowDetection: false, sampledAt: '2026-02-03T10:30',
      eventLabel: '', lab: '', evidenceId: null, note: '',
    })
  })

  it('sends the entry as the API expects it: trimmed, blanks as null, the time as an ISO instant', () => {
    const request = buildResultRequest({
      outfallId: OF1, parameter: ' TSS ', value: ' 42.5 ', unit: ' mg/L ', belowDetection: false, sampledAt: '2026-02-03T10:30',
      eventLabel: ' QSE 2026-02-03 ', lab: '  ', evidenceId: 'tenant/monitoring/a.pdf', note: '',
    })
    expect(request).toEqual({
      ok: true,
      body: {
        outfall_id: OF1, parameter: 'TSS', value: 42.5, unit: 'mg/L', below_detection: false, sampled_at: at.toISOString(),
        event_label: 'QSE 2026-02-03', lab: null, evidence_id: 'tenant/monitoring/a.pdf', note: null,
      },
    })
  })

  it('sends no outfall for a site-level sample, and the below-detection flag as chosen', () => {
    const request = buildResultRequest({ ...blankResultForm(at.getTime()), parameter: 'pH', value: '0', unit: 's.u.', belowDetection: true })
    expect(request).toMatchObject({ ok: true, body: { outfall_id: null, value: 0, below_detection: true } })
  })

  it('says what to fix before sending anything: a result that is not a number, a time that is not one', () => {
    const form = { ...blankResultForm(at.getTime()), parameter: 'TSS', unit: 'mg/L' }
    for (const value of ['', '  ', 'abc', '1,5', 'Infinity']) {
      expect(buildResultRequest({ ...form, value }), value).toEqual({ ok: false, errors: ['Enter the result as a number.'] })
    }
    expect(buildResultRequest({ ...form, value: '1', sampledAt: '' })).toEqual({ ok: false, errors: ['Enter when the sample was taken.'] })
    expect(buildResultRequest({ ...form, value: 'x', sampledAt: '' })).toEqual({ ok: false, errors: ['Enter the result as a number.', 'Enter when the sample was taken.'] })
  })

  it('opens a stored result as it was entered', () => {
    const form = resultToForm(result({ outfallId: OF2, value: 7.25, sampledAt: at.toISOString(), eventLabel: 'QSE', lab: 'Acme', evidenceId: 't/x.pdf', note: 'n', belowDetection: true }))
    expect(form).toEqual({
      outfallId: OF2, parameter: 'TSS', value: '7.25', unit: 'mg/L', belowDetection: true, sampledAt: '2026-02-03T10:30',
      eventLabel: 'QSE', lab: 'Acme', evidenceId: 't/x.pdf', note: 'n',
    })
    expect(resultToForm(result({ outfallId: null })).outfallId).toBe('')
  })
})

describe('the limit form', () => {
  it('starts as a site-wide permit limit, an instantaneous maximum, with nothing filled in', () => {
    expect(blankLimitForm()).toMatchObject({ outfallId: '', kind: 'instantaneous_max', basis: 'permit_limit', value: '', permitId: '' })
  })

  it('sends the entry as the API expects it', () => {
    expect(buildLimitRequest({
      outfallId: OF1, parameter: ' Oil & grease ', kind: 'annual_average', value: '15', unit: ' mg/L ', basis: 'numeric_action_level',
      permitId: '', citation: ' IGP Table 2 ', verify: '', effectiveFrom: '2026-07-01', effectiveTo: '',
    })).toEqual({
      ok: true,
      body: {
        outfall_id: OF1, permit_id: null, parameter: 'Oil & grease', unit: 'mg/L', limit_kind: 'annual_average', value: 15,
        basis: 'numeric_action_level', citation: 'IGP Table 2', verify: null, effective_from: '2026-07-01', effective_to: null,
      },
    })
  })

  it('wants a number for the limit', () => {
    for (const value of ['', 'abc']) expect(buildLimitRequest({ ...blankLimitForm(), value })).toEqual({ ok: false, errors: ['Enter the limit as a number.'] })
  })

  it('opens a stored limit as it was entered', () => {
    const form = limitToForm(limit({ outfallId: OF1, permitId: 'p-1', citation: 'c', verify: 'v', effectiveFrom: '2026-07-01', value: 6.5 }))
    expect(form).toMatchObject({ outfallId: OF1, permitId: 'p-1', citation: 'c', verify: 'v', effectiveFrom: '2026-07-01', effectiveTo: '', value: '6.5' })
  })
})
