import { NextResponse } from 'next/server'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
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
} from '@/lib/environmental/registerApi'
import { IMPACT_COLUMNS } from '@/lib/environmental/changes'

// POST /api/environmental/changes/[id]/impacts/[impactId]/resolve   { resolution_note? }
//   Resolve one impact of an open change. Admins only. The database decides whether it can
//   be resolved (migration 305, plan D14) and says why in plain words, answered here as 409:
//     a transfer step needs evidence; "confirm holder" is refused while the permit still names
//     another holder; the scope and policy impacts close only once those records are updated;
//     any other impact needs a note saying what was done.
//   A resolved impact is sealed, and so is its evidence.

const NOTE_MAX = 2000

interface ImpactContext { params: Promise<{ id: string; impactId: string }> }

export async function POST(req: Request, ctx: ImpactContext) {
  const { id, impactId } = await ctx.params
  if (!UUID_RE.test(id) || !UUID_RE.test(impactId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const note = optionalText(body.resolution_note)
  if (note !== null && note.length > NOTE_MAX) {
    return invalidInput([{ field: 'resolutionNote', message: `must be at most ${NOTE_MAX} characters` }])
  }

  const { data, error } = await gate.authedClient
    .from('ms_change_impacts')
    .update({ resolved_at: new Date().toISOString(), resolution_note: note })
    .eq('id', impactId)
    .eq('change_id', id)
    .eq('tenant_id', gate.tenantId)
    .is('resolved_at', null)
    .select(IMPACT_COLUMNS)
    .maybeSingle()
  // check_violation: a rule above, or the change ended or the impact was resolved meanwhile.
  const code = (error as { code?: string } | null)?.code
  if (code === '23514') return NextResponse.json({ error: (error as { message: string }).message }, { status: 409 })
  if (error) return sanitizeError(error, 'environmental/changes/[id]/impacts/[impactId]/resolve/POST')
  if (data) return NextResponse.json({ impact: data })

  // Nothing matched: no such impact here, or it was already resolved.
  const { data: existing, error: readError } = await gate.authedClient
    .from('ms_change_impacts')
    .select('id')
    .eq('id', impactId)
    .eq('change_id', id)
    .eq('tenant_id', gate.tenantId)
    .maybeSingle()
  if (readError) return sanitizeError(readError, 'environmental/changes/[id]/impacts/[impactId]/resolve/POST read')
  if (!existing) return notFound()
  return NextResponse.json({ error: 'This impact is already resolved.' }, { status: 409 })
}
