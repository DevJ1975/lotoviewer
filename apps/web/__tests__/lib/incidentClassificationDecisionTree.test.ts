import { describe, it, expect } from 'vitest'
import {
  decideRecordability,
  type RecordabilityAnswers,
} from '@soteria/core/incidentClassification'

// Full table-driven coverage of the 1904.7 decision tree. The
// classifier is a pure function — every branch should land on a
// stable classification + a path that explains why.

function answers(over: Partial<RecordabilityAnswers> = {}): RecordabilityAnswers {
  return {
    is_work_related:                 true,
    is_new_case:                     true,
    resulted_in_death:               false,
    resulted_in_days_away:           false,
    days_away_count:                 0,
    resulted_in_restricted_duty:     false,
    days_restricted_count:           0,
    loss_of_consciousness:           false,
    medical_treatment_beyond_first_aid: false,
    significant_diagnosed_condition: false,
    ...over,
  }
}

describe('decideRecordability — gates', () => {
  it('returns not recordable when not work-related', () => {
    const d = decideRecordability(answers({ is_work_related: false, resulted_in_death: true }))
    expect(d.recordable).toBe(false)
    expect(d.classification).toBeNull()
    expect(d.path[0]?.answer).toBe('no')
  })

  it('returns not recordable when not a new case', () => {
    const d = decideRecordability(answers({ is_new_case: false, resulted_in_days_away: true }))
    expect(d.recordable).toBe(false)
    expect(d.classification).toBeNull()
    // Should have walked the work-related question + the new-case question.
    expect(d.path).toHaveLength(2)
  })
})

describe('decideRecordability — outcomes (most-serious-wins)', () => {
  it('death wins over everything', () => {
    const d = decideRecordability(answers({
      resulted_in_death:           true,
      resulted_in_days_away:       true,
      resulted_in_restricted_duty: true,
      medical_treatment_beyond_first_aid: true,
    }))
    expect(d.classification).toBe('death')
  })

  it('days_away wins over restricted', () => {
    const d = decideRecordability(answers({
      resulted_in_days_away:       true,
      resulted_in_restricted_duty: true,
    }))
    expect(d.classification).toBe('days_away')
  })

  it('restricted wins over medical-treatment', () => {
    const d = decideRecordability(answers({
      resulted_in_restricted_duty:        true,
      medical_treatment_beyond_first_aid: true,
    }))
    expect(d.classification).toBe('restricted')
  })

  it('medical-treatment yields other_recordable', () => {
    const d = decideRecordability(answers({
      medical_treatment_beyond_first_aid: true,
    }))
    expect(d.recordable).toBe(true)
    expect(d.classification).toBe('other_recordable')
  })

  it('loss_of_consciousness yields other_recordable on its own', () => {
    const d = decideRecordability(answers({ loss_of_consciousness: true }))
    expect(d.classification).toBe('other_recordable')
  })

  it('significant diagnosed condition yields other_recordable on its own', () => {
    const d = decideRecordability(answers({ significant_diagnosed_condition: true }))
    expect(d.classification).toBe('other_recordable')
  })

  it('a passing case (work-related, new, no outcomes) is not recordable', () => {
    const d = decideRecordability(answers())
    expect(d.recordable).toBe(false)
    expect(d.classification).toBeNull()
    // Walked all eight questions.
    expect(d.path.length).toBeGreaterThanOrEqual(7)
  })
})

describe('decideRecordability — path captures the day counts', () => {
  it('records days_away_count on the days-away question', () => {
    const d = decideRecordability(answers({
      resulted_in_days_away: true,
      days_away_count:       7,
    }))
    const dayQ = d.path.find(p => p.question.includes('days away'))
    expect(dayQ?.reason).toMatch(/7/)
  })

  it('records days_restricted_count on the restricted question', () => {
    const d = decideRecordability(answers({
      resulted_in_restricted_duty: true,
      days_restricted_count:       3,
    }))
    const dayQ = d.path.find(p => p.question.includes('restricted'))
    expect(dayQ?.reason).toMatch(/3/)
  })
})
