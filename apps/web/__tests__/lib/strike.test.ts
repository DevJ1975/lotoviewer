import { describe, expect, it } from 'vitest'
import {
  computeStrikeReadiness,
  isStrikeAssignmentApplicable,
  isStrikeCompletionCurrent,
  normalizeStrikeSlug,
  scoreStrikeQuiz,
  strikeCompletionFloor,
} from '@soteria/core/strike'

describe('strike completion lineage (supersession floor)', () => {
  const v1 = { id: 'v1', versionNumber: 1, supersedesCompletions: false }
  const v2Material = { id: 'v2', versionNumber: 2, supersedesCompletions: true }
  const v3Typo = { id: 'v3', versionNumber: 3, supersedesCompletions: false }

  it('a minor edit keeps every earlier completion current', () => {
    const lineage = [v1, { ...v2Material, supersedesCompletions: false }]
    expect(strikeCompletionFloor(lineage)).toBe(1)
    expect(isStrikeCompletionCurrent({ completedAt: '2026-05-01', moduleVersionId: 'v1', lineage })).toBe(true)
  })

  it('a material change retires completions below it, and a later typo fix does not move the floor', () => {
    const lineage = [v1, v2Material, v3Typo]
    expect(strikeCompletionFloor(lineage)).toBe(2)
    expect(isStrikeCompletionCurrent({ completedAt: '2026-05-01', moduleVersionId: 'v1', lineage })).toBe(false)
    expect(isStrikeCompletionCurrent({ completedAt: '2026-05-01', moduleVersionId: 'v2', lineage })).toBe(true)
    expect(isStrikeCompletionCurrent({ completedAt: '2026-05-01', moduleVersionId: 'v3', lineage })).toBe(true)
  })

  it('treats a completion of an unknown version as not current once a floor exists', () => {
    expect(isStrikeCompletionCurrent({ completedAt: '2026-05-01', moduleVersionId: 'v0', lineage: [v1, v2Material] })).toBe(false)
  })
})

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

  it('matches department and site against the roster labels, ignoring case and spacing', () => {
    const base = { userId: 'user-1', role: 'member', department: 'Sanitation ', site: 'City of Industry' }
    expect(isStrikeAssignmentApplicable({ ...base, targetType: 'department', targetId: 'sanitation' })).toBe(true)
    expect(isStrikeAssignmentApplicable({ ...base, targetType: 'department', targetId: 'Packaging' })).toBe(false)
    expect(isStrikeAssignmentApplicable({ ...base, targetType: 'site', targetId: 'city of industry' })).toBe(true)
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
  // The points column allows 0. A quiz whose questions are all worth 0 used to
  // score 100% for a blank submission, passing everyone without an answer.
  it('makes the answers count even when every question is worth 0 points', () => {
    const questions = [
      { questionId: 'q1', questionType: 'multiple_choice' as const, points: 0, correctAnswerIds: ['a'] },
      { questionId: 'q2', questionType: 'multiple_choice' as const, points: 0, correctAnswerIds: ['b'] },
    ]
    expect(scoreStrikeQuiz({ questions, answersByQuestionId: {}, passingScore: 80 })).toMatchObject({ scorePercent: 0, passed: false })
    expect(scoreStrikeQuiz({ questions, answersByQuestionId: { q1: 'a', q2: 'b' }, passingScore: 80 })).toMatchObject({ scorePercent: 100, passed: true })
  })

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
