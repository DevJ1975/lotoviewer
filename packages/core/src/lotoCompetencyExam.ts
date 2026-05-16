// §1910.147(c)(7) competency-exam scoring + question-shape validation.
//
// The DB stores `questions` and `answers` as opaque jsonb. The TS
// validator pins the shape so the proctored take page + the create
// page agree on the question schema. Scoring is pure: given the exam
// + a set of answers, returns score (0-100) and pass/fail.
//
// No DB, no React.

export type CompetencyExamRole = 'operator' | 'supervisor' | 'energy_iso' | 'rescue'

export const COMPETENCY_EXAM_ROLE_LABELS: Record<CompetencyExamRole, string> = {
  operator:   'Authorized employee operator',
  supervisor: 'Supervisor',
  energy_iso: 'Energy-isolation specialist',
  rescue:     'Rescue / emergency response',
}

export interface CompetencyExamQuestion {
  prompt: string
  /** 2-5 distinct choices. The validator enforces this range. */
  choices: string[]
  /** 0-based index into `choices`. */
  answer_index: number
}

export interface CompetencyExam {
  id: string
  tenant_id: string
  title: string
  role: CompetencyExamRole
  questions: CompetencyExamQuestion[]
  passing_score: number
  active: boolean
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface CompetencyExamAttempt {
  id: string
  tenant_id: string
  exam_id: string
  worker_id: string
  proctor_user_id: string | null
  started_at: string
  completed_at: string | null
  score: number | null
  passed: boolean | null
  answers: number[]
  training_record_id: string | null
  created_at: string
}

export interface ScoredAttempt {
  score: number
  passed: boolean
  correct_count: number
  total: number
}

/**
 * Score an attempt against the exam.
 *
 * Missing answers (caller didn't provide an index for a question) are
 * scored as wrong. Indices outside the choice array are wrong too.
 * Integer percent rounded to nearest; ties to passing favor the
 * worker (>= passing_score is a pass).
 *
 * Empty exams (no questions) score 100/passed — the operator
 * shouldn't create a zero-question exam, but the function shouldn't
 * crash if they did.
 */
export function scoreAttempt(
  exam: Pick<CompetencyExam, 'questions' | 'passing_score'>,
  answers: number[],
): ScoredAttempt {
  const total = exam.questions.length
  if (total === 0) {
    return { score: 100, passed: true, correct_count: 0, total: 0 }
  }
  let correct = 0
  for (let i = 0; i < total; i++) {
    const q = exam.questions[i]
    const a = answers[i]
    if (typeof a !== 'number') continue
    if (a < 0 || a >= q.choices.length) continue
    if (a === q.answer_index) correct++
  }
  const score = Math.round((correct / total) * 100)
  return {
    score,
    passed: score >= exam.passing_score,
    correct_count: correct,
    total,
  }
}

export interface QuestionValidationIssue {
  index: number
  message: string
}

/**
 * Validate a question array before saving the exam. Catches the
 * common authoring errors:
 *   - empty prompt
 *   - <2 or >5 choices
 *   - duplicate choices
 *   - answer_index out of bounds
 */
export function validateQuestions(questions: CompetencyExamQuestion[]): QuestionValidationIssue[] {
  const issues: QuestionValidationIssue[] = []
  questions.forEach((q, i) => {
    if (!q.prompt || q.prompt.trim().length === 0) {
      issues.push({ index: i, message: 'Prompt is required.' })
    }
    if (q.choices.length < 2) {
      issues.push({ index: i, message: 'At least two choices are required.' })
    } else if (q.choices.length > 5) {
      issues.push({ index: i, message: 'No more than five choices per question.' })
    }
    const trimmed = q.choices.map(c => c.trim().toLowerCase())
    const unique = new Set(trimmed)
    if (unique.size !== trimmed.length) {
      issues.push({ index: i, message: 'Choices must be distinct.' })
    }
    if (q.answer_index < 0 || q.answer_index >= q.choices.length) {
      issues.push({ index: i, message: 'answer_index is out of bounds.' })
    }
  })
  return issues
}
