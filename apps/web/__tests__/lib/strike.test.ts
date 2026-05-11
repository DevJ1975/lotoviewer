import { describe, expect, it } from 'vitest'
import {
  computeStrikeReadiness,
  isStrikeAssignmentApplicable,
  isStrikeCompletionCurrent,
  normalizeStrikeSlug,
  scoreStrikeQuiz,
} from '@soteria/core/strike'

describe('isStrikeCompletionCurrent', () => {
  it('accepts completed training with no expiration', () => {
    expect(isStrikeCompletionCurrent({ completedAt: '2026-05-01T12:00:00Z' })).toBe(true)
  })

  it('rejects expired training', () => {
    expect(isStrikeCompletionCurrent({
      completedAt: '2026-05-01T12:00:00Z',
      expiresAt: '2026-05-03T12:00:00Z',
      now: '2026-05-10T12:00:00Z',
    })).toBe(false)
  })

  it('rejects a completion for an older required version', () => {
    expect(isStrikeCompletionCurrent({
      completedAt: '2026-05-01T12:00:00Z',
      moduleVersionId: 'v1',
      requiredVersionId: 'v2',
    })).toBe(false)
  })
})

describe('computeStrikeReadiness', () => {
  it('marks tasks with no requirements as not required', () => {
    expect(computeStrikeReadiness({ requiredCount: 0, validCompletionCount: 0 })).toEqual({
      status: 'not_required',
      percent: 100,
      missingCount: 0,
    })
  })

  it('marks all completed requirements as ready', () => {
    expect(computeStrikeReadiness({ requiredCount: 3, validCompletionCount: 3 })).toEqual({
      status: 'ready',
      percent: 100,
      missingCount: 0,
    })
  })

  it('marks some completed requirements as partial', () => {
    expect(computeStrikeReadiness({ requiredCount: 4, validCompletionCount: 1 })).toEqual({
      status: 'partial',
      percent: 25,
      missingCount: 3,
    })
  })

  it('marks no valid completions as blocked', () => {
    expect(computeStrikeReadiness({ requiredCount: 2, validCompletionCount: 0 })).toEqual({
      status: 'blocked',
      percent: 0,
      missingCount: 2,
    })
  })
})

describe('isStrikeAssignmentApplicable', () => {
  it('allows tenant-wide assignments for every learner', () => {
    expect(isStrikeAssignmentApplicable({
      targetType: 'tenant',
      targetId: null,
      userId: 'user-1',
      role: 'member',
    })).toBe(true)
  })

  it('only allows user-targeted assignments for that user', () => {
    expect(isStrikeAssignmentApplicable({
      targetType: 'user',
      targetId: 'user-1',
      userId: 'user-1',
      role: 'member',
    })).toBe(true)
    expect(isStrikeAssignmentApplicable({
      targetType: 'user',
      targetId: 'user-2',
      userId: 'user-1',
      role: 'member',
    })).toBe(false)
  })

  it('only allows role-targeted assignments for that role', () => {
    expect(isStrikeAssignmentApplicable({
      targetType: 'role',
      targetId: 'admin',
      userId: 'user-1',
      role: 'admin',
    })).toBe(true)
    expect(isStrikeAssignmentApplicable({
      targetType: 'role',
      targetId: 'admin',
      userId: 'user-1',
      role: 'member',
    })).toBe(false)
  })

  it('does not infer site or department applicability without worker context', () => {
    expect(isStrikeAssignmentApplicable({
      targetType: 'site',
      targetId: 'site-1',
      userId: 'user-1',
      role: 'member',
    })).toBe(false)
  })
})

describe('normalizeStrikeSlug', () => {
  it('normalizes a module title into a stable slug', () => {
    expect(normalizeStrikeSlug('LOTO Verification Refresher!')).toBe('loto-verification-refresher')
  })

  it('falls back when a title has no sluggable characters', () => {
    expect(normalizeStrikeSlug('---')).toBe('strike-module')
  })
})

describe('scoreStrikeQuiz', () => {
  it('scores exact single and select-all answers', () => {
    expect(scoreStrikeQuiz({
      passingScore: 80,
      questions: [
        { questionId: 'q1', questionType: 'multiple_choice', correctAnswerIds: ['a'], points: 1 },
        { questionId: 'q2', questionType: 'select_all', correctAnswerIds: ['b', 'c'], points: 1 },
      ],
      answersByQuestionId: {
        q1: 'a',
        q2: ['c', 'b'],
      },
    })).toMatchObject({
      scorePercent: 100,
      passed: true,
      missedQuestionIds: [],
    })
  })

  it('rejects partially correct select-all answers', () => {
    expect(scoreStrikeQuiz({
      passingScore: 80,
      questions: [
        { questionId: 'q1', questionType: 'select_all', correctAnswerIds: ['a', 'b'], points: 1 },
      ],
      answersByQuestionId: { q1: ['a'] },
    })).toMatchObject({
      scorePercent: 0,
      passed: false,
      missedQuestionIds: ['q1'],
    })
  })

  it('accepts acknowledgement answers', () => {
    expect(scoreStrikeQuiz({
      passingScore: 100,
      questions: [
        { questionId: 'q1', questionType: 'acknowledgement', correctAnswerIds: [], points: 1 },
      ],
      answersByQuestionId: { q1: true },
    })).toMatchObject({ scorePercent: 100, passed: true })
  })

  it('fails non-acknowledgement questions that have no configured correct answer', () => {
    expect(scoreStrikeQuiz({
      passingScore: 100,
      questions: [
        { questionId: 'q1', questionType: 'multiple_choice', correctAnswerIds: [], points: 1 },
      ],
      answersByQuestionId: {},
    })).toMatchObject({
      scorePercent: 0,
      passed: false,
      missedQuestionIds: ['q1'],
    })
  })
})
