import { describe, it, expect } from 'vitest'
import {
  scoreAttempt,
  validateQuestions,
  type CompetencyExamQuestion,
} from '@soteria/core/lotoCompetencyExam'

const Q: CompetencyExamQuestion[] = [
  { prompt: 'Which step verifies zero energy?', choices: ['Lockout', 'Isolate', 'Tryout', 'Shutdown'], answer_index: 2 },
  { prompt: 'Who applies a personal lock?',     choices: ['Anyone',  'The authorized employee'],       answer_index: 1 },
]

describe('scoreAttempt', () => {
  it('returns 100 / passed when every answer is correct', () => {
    const r = scoreAttempt({ questions: Q, passing_score: 80 }, [2, 1])
    expect(r).toEqual({ score: 100, passed: true, correct_count: 2, total: 2 })
  })

  it('returns 0 / failed when every answer is wrong', () => {
    const r = scoreAttempt({ questions: Q, passing_score: 80 }, [0, 0])
    expect(r).toEqual({ score: 0, passed: false, correct_count: 0, total: 2 })
  })

  it('rounds the score to the nearest integer', () => {
    // 1 of 2 correct = 50; passing 80 → fail
    const r = scoreAttempt({ questions: Q, passing_score: 80 }, [2, 0])
    expect(r.score).toBe(50)
    expect(r.passed).toBe(false)
  })

  it('treats missing answers as wrong', () => {
    const r = scoreAttempt({ questions: Q, passing_score: 50 }, [2])
    expect(r).toEqual({ score: 50, passed: true, correct_count: 1, total: 2 })
  })

  it('treats out-of-range indices as wrong', () => {
    const r = scoreAttempt({ questions: Q, passing_score: 50 }, [99, 1])
    expect(r).toEqual({ score: 50, passed: true, correct_count: 1, total: 2 })
  })

  it('treats non-number entries as wrong', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = scoreAttempt({ questions: Q, passing_score: 100 }, [2, undefined as any])
    expect(r.passed).toBe(false)
    expect(r.correct_count).toBe(1)
  })

  it('passes at the exact threshold (>=)', () => {
    const r = scoreAttempt({ questions: Q, passing_score: 50 }, [0, 1])
    expect(r.score).toBe(50)
    expect(r.passed).toBe(true)
  })

  it('handles a zero-question exam without crashing (treated as a pass)', () => {
    const r = scoreAttempt({ questions: [], passing_score: 80 }, [])
    expect(r).toEqual({ score: 100, passed: true, correct_count: 0, total: 0 })
  })
})

describe('validateQuestions', () => {
  it('returns no issues for valid questions', () => {
    expect(validateQuestions(Q)).toEqual([])
  })

  it('flags an empty prompt', () => {
    const issues = validateQuestions([{ prompt: '   ', choices: ['a', 'b'], answer_index: 0 }])
    expect(issues).toEqual([{ index: 0, message: 'Prompt is required.' }])
  })

  it('flags fewer than two choices', () => {
    const issues = validateQuestions([{ prompt: 'p', choices: ['a'], answer_index: 0 }])
    expect(issues).toContainEqual({ index: 0, message: 'At least two choices are required.' })
  })

  it('flags more than five choices', () => {
    const issues = validateQuestions([{ prompt: 'p', choices: ['a', 'b', 'c', 'd', 'e', 'f'], answer_index: 0 }])
    expect(issues).toContainEqual({ index: 0, message: 'No more than five choices per question.' })
  })

  it('flags duplicate choices (case + whitespace insensitive)', () => {
    const issues = validateQuestions([{ prompt: 'p', choices: ['Yes', ' yes '], answer_index: 0 }])
    expect(issues).toContainEqual({ index: 0, message: 'Choices must be distinct.' })
  })

  it('flags an out-of-bounds answer_index', () => {
    const issues = validateQuestions([{ prompt: 'p', choices: ['a', 'b'], answer_index: 5 }])
    expect(issues).toContainEqual({ index: 0, message: 'answer_index is out of bounds.' })
  })
})
