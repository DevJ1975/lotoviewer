import { NextResponse } from 'next/server'
import type { FieldError } from '@soteria/core/hazardousWaste'
import { EVALUATION_RESULTS, evaluationCompletionGaps, type EvaluationResult } from '@soteria/core/complianceEvaluation'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  gateFailure,
  invalidInput,
  invalidJson,
  notFound,
  optionalText,
  readJsonObject,
  text,
  type JsonObject,
  type RouteContext,
} from '@/lib/environmental/registerApi'

// POST /api/environmental/evaluations/[id]/complete   Record the result of a compliance
//   evaluation (clause 9.1.2): { result, notes?, nonconformity? }. Tenant admins and the
//   evaluation's assignee may complete it; once complete it is sealed (migration 298).
//
//   compliant / noncompliant  need at least one current evidence file attached first
//   not_applicable            needs notes saying why
//   noncompliant              opens a nonconformity, { nonconformity: { title, description?,
//                             classification? } }, linked from the evaluation (plan D6)

const ADMIN_ROLES = new Set(['owner', 'admin', 'superadmin'])
const CLASSIFICATIONS = ['observation', 'minor', 'major'] as const
const NOTES_MAX = 4000

interface EvaluationRow {
  id: string; obligation_id: string; facility_id: string | null; assigned_to: string | null; completed_at: string | null
}

interface NonconformityInput { title: string; description: string | null; classification: string }

function nonconformityFrom(raw: unknown): { input: NonconformityInput | null; errors: FieldError[] } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { input: null, errors: [{ field: 'nonconformity', message: 'is required for a noncompliant result: { title }' }] }
  }
  const body = raw as JsonObject
  const input = {
    title:          text(body.title),
    description:    optionalText(body.description),
    classification: optionalText(body.classification) ?? 'minor',
  }
  const errors: FieldError[] = []
  if (input.title.length === 0) errors.push({ field: 'nonconformity.title', message: 'is required' })
  else if (input.title.length > 300) errors.push({ field: 'nonconformity.title', message: 'must be at most 300 characters' })
  if (input.description !== null && input.description.length > NOTES_MAX) {
    errors.push({ field: 'nonconformity.description', message: `must be at most ${NOTES_MAX} characters` })
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    errors.push({ field: 'nonconformity.classification', message: 'must be observation, minor, or major' })
  }
  return { input, errors }
}

export async function POST(req: Request, ctx: RouteContext) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()

  const result = text(body.result) as EvaluationResult
  const notes = optionalText(body.notes)
  const errors: FieldError[] = []
  if (!EVALUATION_RESULTS.includes(result)) {
    errors.push({ field: 'result', message: `must be one of ${EVALUATION_RESULTS.join(', ')}` })
  }
  if (notes !== null && notes.length > NOTES_MAX) errors.push({ field: 'notes', message: `must be at most ${NOTES_MAX} characters` })
  const finding = result === 'noncompliant' ? nonconformityFrom(body.nonconformity) : { input: null, errors: [] }
  errors.push(...finding.errors)
  if (errors.length > 0) return invalidInput(errors)

  const { data, error: readError } = await gate.authedClient
    .from('ms_compliance_evaluations')
    .select('id, obligation_id, facility_id, assigned_to, completed_at')
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/evaluations/[id]/complete/POST read')
  if (!data) return notFound()
  const evaluation = data as EvaluationRow
  if (evaluation.completed_at) {
    return NextResponse.json({ error: 'This evaluation is already complete and sealed.' }, { status: 409 })
  }
  if (!ADMIN_ROLES.has(gate.role) && evaluation.assigned_to !== gate.userId) {
    return NextResponse.json({ error: 'Only an admin or the assigned evaluator can complete this evaluation.' }, { status: 403 })
  }

  const { data: evidence, error: evidenceError } = await gate.authedClient
    .from('ms_evidence')
    .select('id')
    .eq('tenant_id', gate.tenantId)
    .eq('subject_type', 'compliance_evaluation')
    .eq('subject_id', id)
    .is('superseded_by', null)
  if (evidenceError) return sanitizeError(evidenceError, 'environmental/evaluations/[id]/complete/POST evidence')
  const gaps = evaluationCompletionGaps({ result, evidenceCount: (evidence ?? []).length, notes })
  if (gaps.length > 0) {
    return NextResponse.json({ error: 'This evaluation cannot close yet.', gaps }, { status: 422 })
  }

  let nonconformity: { id: string } | null = null
  if (finding.input) {
    const { data: created, error } = await gate.authedClient
      .from('nonconformities')
      .insert({
        tenant_id:        gate.tenantId,
        facility_id:      evaluation.facility_id,
        title:            finding.input.title,
        description:      finding.input.description,
        classification:   finding.input.classification,
        source_type:      'compliance',
        source_reference: evaluation.obligation_id,
        clause_ref:       '9.1.2',
        identified_by:    gate.userId,
        created_by:       gate.userId,
        updated_by:       gate.userId,
      })
      .select('*')
      .single()
    if (error) return sanitizeError(error, 'environmental/evaluations/[id]/complete/POST nonconformity')
    nonconformity = created as { id: string }
  }

  // The nonconformity exists only for this result; if the result is not recorded, take it back.
  const withdrawNonconformity = async () => {
    if (nonconformity) await gate.authedClient.from('nonconformities').delete().eq('id', nonconformity.id).eq('tenant_id', gate.tenantId)
  }

  const { data: completed, error } = await gate.authedClient
    .from('ms_compliance_evaluations')
    .update({
      completed_at:     new Date().toISOString(),
      result,
      evaluator_id:     gate.userId,
      notes,
      nonconformity_id: nonconformity?.id ?? null,
    })
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .is('completed_at', null)
    .select('*')
    .maybeSingle()
  if (error) {
    await withdrawNonconformity()
    // 23514: the evidence was superseded away between the check above and this write.
    if ((error as { code?: string }).code === '23514') {
      return NextResponse.json({ error: 'This evaluation cannot close yet.', gaps: ['evidence_required'] }, { status: 422 })
    }
    return sanitizeError(error, 'environmental/evaluations/[id]/complete/POST')
  }
  if (!completed) {
    await withdrawNonconformity()
    return NextResponse.json({ error: 'Someone else completed this evaluation first.' }, { status: 409 })
  }
  return NextResponse.json({ evaluation: completed, nonconformity })
}
