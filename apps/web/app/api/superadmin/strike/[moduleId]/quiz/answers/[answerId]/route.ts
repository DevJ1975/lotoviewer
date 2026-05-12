import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  UUID_RE,
  loadAnswerForModule,
  normalizeAnswerText,
  normalizeBool,
  normalizeNonNegativeInt,
} from '../../_lib'

export const runtime = 'nodejs'

interface RouteContext { params: Promise<{ moduleId: string; answerId: string }> }

export async function PATCH(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId, answerId } = await ctx.params
  if (!UUID_RE.test(moduleId) || !UUID_RE.test(answerId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const admin = supabaseAdmin()
  const scope = await loadAnswerForModule(admin, moduleId, answerId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const updates: Record<string, unknown> = {}
  if (body.answer_text !== undefined) {
    const text = normalizeAnswerText(body.answer_text)
    if (!text) return NextResponse.json({ error: 'answer_text must be 1-1000 chars' }, { status: 400 })
    updates.answer_text = text
  }
  if (body.is_correct !== undefined) {
    const correct = normalizeBool(body.is_correct)
    if (correct === undefined) return NextResponse.json({ error: 'is_correct must be boolean' }, { status: 400 })
    updates.is_correct = correct
  }
  if (body.sort_order !== undefined) {
    const sort = normalizeNonNegativeInt(body.sort_order)
    if (sort === null) return NextResponse.json({ error: 'sort_order must be >= 0' }, { status: 400 })
    updates.sort_order = sort
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  const { data: answer, error } = await admin
    .from('strike_quiz_answers')
    .update(updates)
    .eq('id', answerId)
    .select('id, question_id, answer_text, is_correct, sort_order')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ answer })
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId, answerId } = await ctx.params
  if (!UUID_RE.test(moduleId) || !UUID_RE.test(answerId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const scope = await loadAnswerForModule(admin, moduleId, answerId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const { error } = await admin.from('strike_quiz_answers').delete().eq('id', answerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
