import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  UUID_RE,
  loadQuestionForModule,
  normalizeBool,
  normalizeNonNegativeInt,
  normalizeOptionalString,
  normalizePrompt,
  normalizeQuestionType,
} from '../../_lib'

export const runtime = 'nodejs'

interface RouteContext { params: Promise<{ moduleId: string; questionId: string }> }

export async function PATCH(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId, questionId } = await ctx.params
  if (!UUID_RE.test(moduleId) || !UUID_RE.test(questionId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = supabaseAdmin()
  const scope = await loadQuestionForModule(admin, moduleId, questionId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const updates: Record<string, unknown> = {}
  if (body.prompt !== undefined) {
    const prompt = normalizePrompt(body.prompt)
    if (!prompt) return NextResponse.json({ error: 'Prompt must be 1-2000 chars' }, { status: 400 })
    updates.prompt = prompt
  }
  if (body.question_type !== undefined) {
    const qt = normalizeQuestionType(body.question_type)
    if (!qt) return NextResponse.json({ error: 'Invalid question_type' }, { status: 400 })
    updates.question_type = qt
  }
  if (body.explanation !== undefined) {
    const explanation = normalizeOptionalString(body.explanation)
    updates.explanation = explanation === undefined ? null : explanation
  }
  if (body.required !== undefined) {
    const required = normalizeBool(body.required)
    if (required === undefined) return NextResponse.json({ error: 'required must be boolean' }, { status: 400 })
    updates.required = required
  }
  if (body.points !== undefined) {
    const points = normalizeNonNegativeInt(body.points)
    if (points === null) return NextResponse.json({ error: 'points must be >= 0' }, { status: 400 })
    updates.points = points
  }
  if (body.sort_order !== undefined) {
    const sort = normalizeNonNegativeInt(body.sort_order)
    if (sort === null) return NextResponse.json({ error: 'sort_order must be >= 0' }, { status: 400 })
    updates.sort_order = sort
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const { data: question, error } = await admin
    .from('strike_quiz_questions')
    .update(updates)
    .eq('id', questionId)
    .select('id, module_version_id, question_type, prompt, explanation, sort_order, required, points')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ question })
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId, questionId } = await ctx.params
  if (!UUID_RE.test(moduleId) || !UUID_RE.test(questionId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const scope = await loadQuestionForModule(admin, moduleId, questionId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const { error } = await admin.from('strike_quiz_questions').delete().eq('id', questionId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
