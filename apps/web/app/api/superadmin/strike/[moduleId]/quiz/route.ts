import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { STRIKE_QUESTION_TYPES, type StrikeQuestionType } from '@soteria/core/strike'

// Read-only snapshot used by the Quiz Maker UI. Writes flow through the
// sibling /questions and /answers sub-routes — keeps each handler small
// and the audit log per-row precise. Returns every version (newest first)
// so editors can reuse questions from an old draft.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface QuizVersionRow {
  id: string
  version_number: number
  status: string
  passing_score: number
  duration_seconds: number | null
  video_path: string | null
}

export interface QuizQuestionRow {
  id: string
  module_version_id: string
  question_type: StrikeQuestionType
  prompt: string
  explanation: string | null
  sort_order: number
  required: boolean
  points: number
  answers: QuizAnswerRow[]
}

export interface QuizAnswerRow {
  id: string
  question_id: string
  answer_text: string
  is_correct: boolean
  sort_order: number
}

export interface QuizResponse {
  module: {
    id: string
    title: string
    slug: string
    library_scope: 'global' | 'tenant'
    tenant_id: string | null
  }
  versions: QuizVersionRow[]
  questions: QuizQuestionRow[]
  question_types: readonly StrikeQuestionType[]
}

interface RouteContext { params: Promise<{ moduleId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: moduleRow, error: moduleErr } = await admin
    .from('strike_modules')
    .select('id, title, slug, library_scope, tenant_id')
    .eq('id', moduleId)
    .maybeSingle()
  if (moduleErr) return NextResponse.json({ error: moduleErr.message }, { status: 500 })
  if (!moduleRow) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const { data: versions, error: versionsErr } = await admin
    .from('strike_module_versions')
    .select('id, version_number, status, passing_score, duration_seconds, video_path')
    .eq('module_id', moduleId)
    .order('version_number', { ascending: false })
  if (versionsErr) return NextResponse.json({ error: versionsErr.message }, { status: 500 })

  const versionIds = (versions ?? []).map(v => v.id as string)
  if (versionIds.length === 0) {
    return NextResponse.json({
      module: moduleRow,
      versions: [],
      questions: [],
      question_types: STRIKE_QUESTION_TYPES,
    } satisfies QuizResponse)
  }

  const { data: questionRows, error: questionsErr } = await admin
    .from('strike_quiz_questions')
    .select('id, module_version_id, question_type, prompt, explanation, sort_order, required, points')
    .in('module_version_id', versionIds)
    .order('module_version_id', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('id', { ascending: true })
  if (questionsErr) return NextResponse.json({ error: questionsErr.message }, { status: 500 })

  const questionIds = (questionRows ?? []).map(q => q.id as string)
  const { data: answerRows, error: answersErr } = questionIds.length === 0
    ? { data: [], error: null }
    : await admin
      .from('strike_quiz_answers')
      .select('id, question_id, answer_text, is_correct, sort_order')
      .in('question_id', questionIds)
      .order('question_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true })
  if (answersErr) return NextResponse.json({ error: answersErr.message }, { status: 500 })

  const answersByQuestion = new Map<string, QuizAnswerRow[]>()
  for (const a of answerRows ?? []) {
    const list = answersByQuestion.get(a.question_id as string) ?? []
    list.push(a as QuizAnswerRow)
    answersByQuestion.set(a.question_id as string, list)
  }

  const questions = (questionRows ?? []).map(q => ({
    ...q,
    answers: answersByQuestion.get(q.id as string) ?? [],
  })) as QuizQuestionRow[]

  return NextResponse.json({
    module: moduleRow,
    versions: (versions ?? []) as QuizVersionRow[],
    questions,
    question_types: STRIKE_QUESTION_TYPES,
  } satisfies QuizResponse)
}
