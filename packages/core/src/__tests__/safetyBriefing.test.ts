import { describe, it, expect } from 'vitest'
import { buildSafetyBriefing } from '../safetyBriefing'
import type { IncidentRiskResult, IncidentRiskDriver } from '../incidentRiskModel'
import type { PrecursorPattern } from '../precursorRules'
import type { CountForecast } from '../forecast'

// The briefing is what a safety lead reads on a Monday. Its contract is that
// every line is checkable and no line claims more than the maths supports.

const driver = (over: Partial<IncidentRiskDriver> = {}): IncidentRiskDriver => ({
  key:             'capa_overdue',
  label:           'Overdue corrective actions (CAPAs)',
  kind:            'leading',
  pressure:        60,
  contribution:    9.6,
  value:           '3 overdue',
  target:          '0 overdue',
  href:            '/incidents',
  suggestedAction: 'Close overdue CAPAs.',
  ...over,
})

const risk = (over: Partial<IncidentRiskResult> = {}): IncidentRiskResult => ({
  score:        42,
  band:         'moderate',
  drivers:      [driver()],
  modelVersion: '2.0.0',
  ...over,
})

const pattern = (over: Partial<PrecursorPattern> = {}): PrecursorPattern => ({
  key:           'known_hazard_left_open',
  label:         'Known hazards left open while near-misses continue',
  severity:      'urgent',
  basis:         'stated premise',
  href:          '/incidents',
  action:        'Close the overdue corrective actions before adding new ones.',
  evidence:      [{ label: 'Overdue corrective actions', value: '4' }],
  validation:    'unvalidated',
  leadMonths:    null,
  historyMonths: 0,
  ...over,
})

describe('score reduction wording', () => {
  it('reports the exact points a driver contributes, not a predicted outcome', () => {
    // The number is arithmetic on a fixed weight vector. Any drift toward
    // "expected incidents avoided" is a fabricated causal claim.
    const { moves } = buildSafetyBriefing({ risk: risk(), patterns: [] })
    const move = moves.find(m => m.source === 'risk_driver')!
    expect(move.scoreReductionIfCleared).toBe(9.6)
    expect(move.rationale).toContain('9.6 of the 42-point risk score')
  })

  it('leaves score reduction null for precursor moves', () => {
    // A precursor is a conjunction of conditions, not a scored indicator —
    // there is no arithmetic to report, so it reports nothing.
    const { moves } = buildSafetyBriefing({ risk: risk({ drivers: [] }), patterns: [pattern()] })
    expect(moves[0].scoreReductionIfCleared).toBeNull()
  })
})

describe('ordering', () => {
  it('puts precursor patterns above single-indicator drivers', () => {
    const { moves } = buildSafetyBriefing({
      risk:     risk({ drivers: [driver({ contribution: 20 })] }),
      patterns: [pattern()],
    })
    expect(moves.map(m => m.source)).toEqual(['precursor', 'risk_driver'])
  })

  it('preserves the rule engine and risk model orderings', () => {
    const { moves } = buildSafetyBriefing({
      risk: risk({ drivers: [driver({ key: 'a', contribution: 12 }), driver({ key: 'b', contribution: 4 })] }),
      patterns: [pattern({ key: 'p1' }), pattern({ key: 'p2', severity: 'elevated' })],
    })
    expect(moves.map(m => m.key)).toEqual(['precursor:p1', 'precursor:p2', 'driver:a', 'driver:b'])
  })

  it('drops drivers too small to matter next to the rest', () => {
    const { moves } = buildSafetyBriefing({
      risk:     risk({ drivers: [driver({ key: 'big', contribution: 11 }), driver({ key: 'noise', contribution: 0.4 })] }),
      patterns: [],
    })
    expect(moves.map(m => m.key)).toEqual(['driver:big'])
  })

  it('honours the limit', () => {
    const drivers = Array.from({ length: 9 }, (_, i) => driver({ key: `d${i}`, contribution: 10 - i * 0.5 }))
    const { moves } = buildSafetyBriefing({ risk: risk({ drivers }), patterns: [], limit: 3 })
    expect(moves).toHaveLength(3)
  })
})

describe('urgency', () => {
  it('reads a saturated indicator as urgent even when its weight is small', () => {
    const { moves } = buildSafetyBriefing({
      risk: risk({ drivers: [driver({ pressure: 100, contribution: 6 })] }), patterns: [],
    })
    expect(moves[0].urgency).toBe('urgent')
  })

  it('reads a quiet indicator as routine', () => {
    const { moves } = buildSafetyBriefing({
      risk: risk({ drivers: [driver({ pressure: 10, contribution: 3 })] }), patterns: [],
    })
    expect(moves[0].urgency).toBe('routine')
  })
})

describe('validation wording', () => {
  it('states measured lead time only for a validated pattern', () => {
    const { moves } = buildSafetyBriefing({
      risk: risk({ drivers: [] }),
      patterns: [pattern({ validation: 'validated', leadMonths: 2, historyMonths: 18 })],
    })
    expect(moves[0].rationale).toContain('led recordables by 2 months over 18 months')
  })

  it('calls an unvalidated pattern a condition to check, never a prediction', () => {
    const { moves } = buildSafetyBriefing({ risk: risk({ drivers: [] }), patterns: [pattern()] })
    expect(moves[0].rationale).toContain('condition to check, not a prediction')
  })

  it('surfaces a contradicted pattern rather than hiding it', () => {
    const { moves } = buildSafetyBriefing({
      risk: risk({ drivers: [] }),
      patterns: [pattern({ validation: 'contradicted' })],
    })
    expect(moves[0].rationale).toContain('history does not support the pattern')
  })
})

describe('outlook', () => {
  const forecast = (over: Partial<CountForecast> = {}): CountForecast => ({
    expected: 2.4, lower: 0, upper: 5.4, trendSlope: 0, r2: 0.1,
    hasTrend: false, basis: 12, ...over,
  })

  it('is null when there is not enough history to forecast', () => {
    // forecastCount returns null below its minimum rather than projecting;
    // the briefing says nothing rather than inventing a flat line.
    expect(buildSafetyBriefing({ risk: risk(), patterns: [], forecast: null }).outlook).toBeNull()
  })

  it('says the trend was too weak to apply when it was', () => {
    const out = buildSafetyBriefing({ risk: risk(), patterns: [], forecast: forecast() }).outlook
    expect(out).toContain('flat run-rate')
    expect(out).toContain('trend fit was too weak')
  })

  it('names the trend direction when the fit is good enough', () => {
    const out = buildSafetyBriefing({
      risk: risk(), patterns: [],
      forecast: forecast({ hasTrend: true, trendSlope: 0.4, r2: 0.6 }),
    }).outlook
    expect(out).toContain('rising trend')
  })
})

describe('headline and all-clear', () => {
  it('reports an empty briefing explicitly rather than looking broken', () => {
    const briefing = buildSafetyBriefing({ risk: risk({ score: 4, band: 'low', drivers: [] }), patterns: [] })
    expect(briefing.allClear).toBe(true)
    expect(briefing.moves).toEqual([])
    expect(briefing.headline).toContain('No precursor patterns are firing')
  })

  it('states the score and pattern count without adjectives', () => {
    const briefing = buildSafetyBriefing({ risk: risk(), patterns: [pattern()] })
    expect(briefing.headline).toBe('Incident risk is moderate (42/100). 1 precursor pattern firing.')
  })
})

it('is deterministic', () => {
  const args = { risk: risk(), patterns: [pattern()] }
  expect(buildSafetyBriefing(args)).toEqual(buildSafetyBriefing(args))
})
