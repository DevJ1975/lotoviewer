import { describe, it, expect } from 'vitest'
import {
  classifyRetraining,
  RETRAINING_TRIGGER_LABELS,
  RETRAINING_CADENCE_DAYS,
  type RetrainingTriggerType,
} from '@soteria/core/lotoRetraining'

const ASOF = new Date('2026-05-15T00:00:00Z')

describe('classifyRetraining', () => {
  it('returns "never_trained" when there is no training record', () => {
    expect(classifyRetraining({ last_trained_at: null, open_trigger_count: 0 }, ASOF))
      .toBe('never_trained')
  })

  it('returns "open_trigger" when an unresolved §147(g)(2) trigger exists', () => {
    // Even if the worker was trained yesterday, an open trigger means
    // their existing cert is no longer adequate — surface that first.
    expect(classifyRetraining({ last_trained_at: '2026-05-14', open_trigger_count: 1 }, ASOF))
      .toBe('open_trigger')
  })

  it('returns "due" when the last training is older than the annual cadence', () => {
    // 400 days ago — outside the 365-day window
    const oldDate = new Date(ASOF.getTime() - 400 * 24 * 60 * 60 * 1000)
    const ymd = oldDate.toISOString().slice(0, 10)
    expect(classifyRetraining({ last_trained_at: ymd, open_trigger_count: 0 }, ASOF))
      .toBe('due')
  })

  it('returns "current" when trained within the cadence and no open trigger', () => {
    expect(classifyRetraining({ last_trained_at: '2026-01-01', open_trigger_count: 0 }, ASOF))
      .toBe('current')
  })

  it('treats an unparseable date as never_trained (defensive)', () => {
    expect(classifyRetraining({ last_trained_at: 'not-a-date', open_trigger_count: 0 }, ASOF))
      .toBe('never_trained')
  })

  it('flips to "due" exactly one day past the cadence', () => {
    const justOver = new Date(ASOF.getTime() - (RETRAINING_CADENCE_DAYS + 1) * 24 * 60 * 60 * 1000)
    const ymd = justOver.toISOString().slice(0, 10)
    expect(classifyRetraining({ last_trained_at: ymd, open_trigger_count: 0 }, ASOF))
      .toBe('due')
  })

  it('stays "current" exactly at the cadence boundary', () => {
    const onBoundary = new Date(ASOF.getTime() - RETRAINING_CADENCE_DAYS * 24 * 60 * 60 * 1000)
    const ymd = onBoundary.toISOString().slice(0, 10)
    expect(classifyRetraining({ last_trained_at: ymd, open_trigger_count: 0 }, ASOF))
      .toBe('current')
  })
})

describe('RETRAINING_TRIGGER_LABELS', () => {
  it('covers every §147(g)(2) trigger type', () => {
    // Compile-time: the type assertion below fails if the labels record
    // doesn't have a key for every literal in RetrainingTriggerType.
    const expected: Record<RetrainingTriggerType, string> = RETRAINING_TRIGGER_LABELS
    expect(Object.keys(expected)).toEqual([
      'new_equipment',
      'new_hazards',
      'procedure_change',
      'deviation_observed',
      'periodic',
    ])
  })
})
