import { describe, it, expect } from 'vitest'
import {
  metricDetailFromDriver, buildIncidentKpiDetails, type IncidentKpiId,
} from '@/components/scorecard/metricDetail'
import type { IncidentRiskDriver } from '@soteria/core/incidentRiskModel'
import type { IncidentScorecardMetrics } from '@soteria/core/incidentScorecardMetrics'

const driver: IncidentRiskDriver = {
  key: 'capa_overdue',
  label: 'Overdue corrective actions (CAPAs)',
  kind: 'leading',
  pressure: 80,
  contribution: 12,
  value: '4 overdue',
  target: '0 overdue',
  href: '/incidents',
  suggestedAction: 'Close overdue CAPAs.',
}

describe('metricDetailFromDriver', () => {
  it('maps a leading driver to a critical-toned detail with definition + stats', () => {
    const d = metricDetailFromDriver(driver)
    expect(d.category).toBe('Leading indicator')
    expect(d.value).toBe('4 overdue')
    expect(d.target).toBe('target 0 overdue')
    expect(d.tone).toBe('critical') // pressure >= 66
    expect(d.href).toBe('/incidents')
    expect(d.definition.length).toBeGreaterThan(0)
    expect(d.stats?.some(s => s.value === '+12')).toBe(true)
  })

  it('tones a low-pressure driver as safe', () => {
    expect(metricDetailFromDriver({ ...driver, pressure: 10 }).tone).toBe('safe')
  })
})

// Minimal fixture — buildIncidentKpiDetails only reads these fields.
function metrics(overrides: Partial<IncidentScorecardMetrics> = {}): IncidentScorecardMetrics {
  return {
    hoursWorked: 200_000,
    totalRecordable: 4,
    totalDeaths: 0,
    totalDaysAwayCases: 2,
    totalRestrictedCases: 1,
    totalDaysAwayCount: 30,
    trir: 4, dart: 3, ltir: 2, severityRate: 30,
    actionClosureOnTimePct: 76,
    rcaCompletionPct: 75,
    recordablesWithCompletedRca: 3,
    meanTimeToCloseDays: 12.5,
    daysSinceLastRecordable: 14,
    ...overrides,
  } as IncidentScorecardMetrics
}

describe('buildIncidentKpiDetails', () => {
  it('returns a detail for every KPI id', () => {
    const k = buildIncidentKpiDetails(metrics())
    const ids: IncidentKpiId[] = ['trir', 'dart', 'ltir', 'severity', 'capa', 'rca', 'time_to_close', 'days_since']
    for (const id of ids) expect(k[id]?.title).toBeTruthy()
  })

  it('embeds the live TRIR formula with actual numbers', () => {
    const k = buildIncidentKpiDetails(metrics())
    expect(k.trir.formula).toContain('4 recordable')
    expect(k.trir.formula).toContain('200,000')
    expect(k.trir.value).toBe('4.00')
  })

  it('explains missing rates when hours are not entered', () => {
    const k = buildIncidentKpiDetails(metrics({ hoursWorked: 0, trir: null, dart: null, ltir: null, severityRate: null }))
    expect(k.trir.value).toBe('—')
    expect(k.trir.narrative.toLowerCase()).toContain('hours')
  })

  it('derives the RCA ratio from completed vs total recordables', () => {
    const k = buildIncidentKpiDetails(metrics())
    expect(k.rca.formula).toContain('3 with RCA')
    expect(k.rca.value).toBe('75%')
  })
})
