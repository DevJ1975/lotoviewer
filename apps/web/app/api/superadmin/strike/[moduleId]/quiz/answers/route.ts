import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  UUID_RE,
  loadQuestionForModule,
  normalizeAnswerText,
  normalizeBool,
  normalizeNonNegativeInt,
} from '../_lib'

export const runtime = 'nodejs'

interface RouteContext { params: Promise<{ moduleId: string }> }

// POST: append an answer to a question. tenant_id + library_scope are
// inherited from the parent version — never trust the client to pick them.
export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const questionId = typeof body.question_id === 'string' ? body.question_id : ''
  if (!UUID_RE.test(questionId)) return NextResponse.json({ error: 'Invalid question_id' }, { status: 400 })

  const answerText = normalizeAnswerText(body.answer_text)
  if (!answerText) return NextResponse.json({ error: 'answer_text is required (1-1000 chars)' }, { status: 400 })

  const admin = supabaseAdmin()
  const scope = await loadQuestionForModule(admin, moduleId, questionId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  let sortOrder = normalizeNonNegativeInt(body.sort_order)
  if (sortOrder === null) {
    const { data: maxRow } = await admin
      .from('strike_quiz_answers')
      .select('sort_order')
      .eq('question_id', questionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = ((maxRow?.sort_order as number | null | undefined) ?? -1) + 1
  }

  const { data: answer, error } = await admin
    .from('strike_quiz_answers')
    .insert({
      question_id: questionId,
      tenant_id: scope.tenantId,
      library_scope: scope.libraryScope,
      answer_text: answerText,
      is_correct: normalizeBool(body.is_correct) ?? false,
      sort_order: sortOrder,
    })
    .select('id, question_id, answer_text, is_correct, sort_order')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ answer }, { status: 201 })
}
