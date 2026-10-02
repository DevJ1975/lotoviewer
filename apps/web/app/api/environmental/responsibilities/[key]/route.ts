import { NextResponse } from 'next/server'
import { isResponsibilityKey } from '@soteria/core/emsProcesses'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  ENVIRONMENTAL_MODULE,
  UUID_RE,
  emsDisciplineParam,
  gateFailure,
  invalidInput,
  invalidJson,
  readJsonObject,
} from '@/lib/environmental/registerApi'

// PUT /api/environmental/responsibilities/[key]   Assign a process or clause 5.3 role to a
//   member: { owner_user_id: <user id> | null, discipline? }. null leaves it unassigned.
//   Admins only. The row is reassigned in place; log_audit() keeps who held it before.
//   The database holds the owner to a membership of this tenant (migration 302), and
//   clears the assignment when that membership is removed.

interface KeyContext { params: Promise<{ key: string }> }

export async function PUT(req: Request, ctx: KeyContext) {
  const { key } = await ctx.params
  if (!isResponsibilityKey(key)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
  if (!gate.ok) return gateFailure(gate)

  const body = await readJsonObject(req)
  if (!body) return invalidJson()
  const rawDiscipline = body.discipline ?? null
  const discipline = typeof rawDiscipline === 'string' || rawDiscipline === null ? emsDisciplineParam(rawDiscipline) : null
  if (!discipline) return invalidInput([{ field: 'discipline', message: 'must be ems or integrated' }])
  const owner = body.owner_user_id
  if (owner !== null && (typeof owner !== 'string' || !UUID_RE.test(owner))) {
    return invalidInput([{ field: 'ownerUserId', message: 'must be a user id, or null to unassign' }])
  }

  const notAMember = () => invalidInput([{ field: 'ownerUserId', message: 'is not a member of this organization' }])
  if (owner !== null) {
    const { data: membership, error } = await supabaseAdmin()
      .from('tenant_memberships')
      .select('user_id')
      .eq('tenant_id', gate.tenantId)
      .eq('user_id', owner)
      .is('invite_cancelled_at', null)
      .maybeSingle()
    if (error) return sanitizeError(error, 'environmental/responsibilities/[key]/PUT owner')
    if (!membership) return notAMember()
  }

  // The membership can go between the check above and the write; the foreign key then refuses it.
  const assignment = { owner_user_id: owner, assigned_by: gate.userId }
  const updated = await gate.authedClient
    .from('ms_responsibilities')
    .update(assignment)
    .eq('tenant_id', gate.tenantId)
    .eq('discipline', discipline)
    .eq('responsibility_key', key)
    .select('*')
    .maybeSingle()
  if ((updated.error as { code?: string } | null)?.code === '23503') return notAMember()
  if (updated.error) return sanitizeError(updated.error, 'environmental/responsibilities/[key]/PUT update')
  if (updated.data) return NextResponse.json({ responsibility: updated.data })

  const inserted = await gate.authedClient
    .from('ms_responsibilities')
    .insert({ tenant_id: gate.tenantId, discipline, responsibility_key: key, ...assignment })
    .select('*')
    .single()
  if ((inserted.error as { code?: string } | null)?.code === '23503') return notAMember()
  if ((inserted.error as { code?: string } | null)?.code === '23505') {
    return NextResponse.json(
      { error: 'Someone assigned this at the same time. Reload and try again.' },
      { status: 409 },
    )
  }
  if (inserted.error) return sanitizeError(inserted.error, 'environmental/responsibilities/[key]/PUT insert')
  return NextResponse.json({ responsibility: inserted.data }, { status: 201 })
}
