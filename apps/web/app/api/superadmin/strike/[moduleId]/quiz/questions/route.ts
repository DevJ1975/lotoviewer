import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  UUID_RE,
  loadVersionForModule,
  normalizeAnswerText,
  normalizeBool,
  normalizeNonNegativeInt,
  normalizeOptionalString,
  normalizePrompt,
  normalizeQuestionType,
} from '../_lib'

export const runtime = 'nodejs'

interface RouteContext { params: Promise<{ moduleId: string }> }

// POST: create a new question (optionally with seed answers).
// Body: {
//   module_version_id: uuid,
//   question_type: StrikeQuestionType,
//   prompt: string,
//   explanation?: string|null,
//   required?: boolean,
//   points?: number,
//   sort_order?: number,
//   answers?: [{ answer_text: string, is_correct?: boolean, sort_order?: number }]
// }
export async function POST(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const versionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(versionId)) return NextResponse.json({ error: 'Invalid module_version_id' }, { status: 400 })

  const questionType = normalizeQuestionType(body.question_type)
  if (!questionType) return NextResponse.json({ error: 'Invalid question_type' }, { status: 400 })

  const prompt = normalizePrompt(body.prompt)
  if (!prompt) return NextResponse.json({ error: 'Prompt is required (1-2000 chars)' }, { status: 400 })

  const admin = supabaseAdmin()
  const scope = await loadVersionForModule(admin, moduleId, versionId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  // Next sort_order = max + 1 if not provided. Keeps the editor's add button
  // append-to-end semantics without forcing the client to compute order.
  let sortOrder = normalizeNonNegativeInt(body.sort_order)
  if (sortOrder === null) {
    const { data: maxRow } = await admin
      .from('strike_quiz_questions')
      .select('sort_order')
      .eq('module_version_id', versionId)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle()
    sortOrder = ((maxRow?.sort_order as number | null | undefined) ?? -1) + 1
  }

  const points = normalizeNonNegativeInt(body.points) ?? 1
  const required = normalizeBool(body.required) ?? true
  const explanation = normalizeOptionalString(body.explanation)

  const { data: question, error: insertErr } = await admin
    .from('strike_quiz_questions')
    .insert({
      module_version_id: versionId,
      tenant_id: scope.tenantId,
      library_scope: scope.libraryScope,
      question_type: questionType,
      prompt,
      explanation: explanation === undefined ? null : explanation,
      sort_order: sortOrder,
      required,
      points,
    })
    .select('id, module_version_id, question_type, prompt, explanation, sort_order, required, points')
    .single()
  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 })

  // Seed answers — best-effort: if one fails, surface the error but keep
  // the question so the editor can let the user retry the failing rows.
  const seedAnswers = Array.isArray(body.answers) ? body.answers : []
  if (seedAnswers.length > 0) {
    const rows = seedAnswers
      .map((raw, index) => {
        if (!raw || typeof raw !== 'object') return null
        const obj = raw as Record<string, unknown>
        const text = normalizeAnswerText(obj.answer_text)
        if (!text) return null
        return {
          question_id: question.id as string,
          tenant_id: scope.tenantId,
          library_scope: scope.libraryScope,
          answer_text: text,
          is_correct: normalizeBool(obj.is_correct) ?? false,
          sort_order: normalizeNonNegativeInt(obj.sort_order) ?? index,
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
    if (rows.length > 0) {
      const { error: ansErr } = await admin.from('strike_quiz_answers').insert(rows)
      if (ansErr) return NextResponse.json({ question, warning: ansErr.message }, { status: 201 })
    }
  }

  return NextResponse.json({ question }, { status: 201 })
}

// PUT: reorder questions for a version. Body: { module_version_id, ordered_ids }.
// One round-trip via upsert; safer than per-row updates that can race.
export async function PUT(req: Request, ctx: RouteContext) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { moduleId } = await ctx.params
  if (!UUID_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid module id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const versionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(versionId)) return NextResponse.json({ error: 'Invalid module_version_id' }, { status: 400 })

  const orderedIds = Array.isArray(body.ordered_ids) ? body.ordered_ids : null
  if (!orderedIds || !orderedIds.every((id): id is string => typeof id === 'string' && UUID_RE.test(id))) {
    return NextResponse.json({ error: 'ordered_ids must be an array of uuids' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const scope = await loadVersionForModule(admin, moduleId, versionId)
  if ('error' in scope) return NextResponse.json({ error: scope.error }, { status: scope.status })

  // Verify every id actually belongs to this version before writing.
  const { data: rows, error: checkErr } = await admin
    .from('strike_quiz_questions')
    .select('id')
    .eq('module_version_id', versionId)
    .in('id', orderedIds)
  if (checkErr) return NextResponse.json({ error: checkErr.message }, { status: 500 })
  if ((rows ?? []).length !== orderedIds.length) {
    return NextResponse.json({ error: 'ordered_ids contains foreign questions' }, { status: 400 })
  }

  // Apply new sort_order positionally. Sequential per-row to avoid sending
  // a multi-row upsert with partial columns (Supabase JS upsert needs the
  // full conflict target). Total: O(n) round-trips, but n is tiny.
  for (let index = 0; index < orderedIds.length; index += 1) {
    const { error: updErr } = await admin
      .from('strike_quiz_questions')
      .update({ sort_order: index })
      .eq('id', orderedIds[index])
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
