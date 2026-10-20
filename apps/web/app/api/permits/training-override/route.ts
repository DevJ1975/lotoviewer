import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadPermitRef, type PermitRef } from '@/lib/permits/permitRef'
import { dispatchNotification } from '@/lib/notify/dispatch'
import { sendPermitTrainingOverrideAlert } from '@/lib/email/sendPermitTrainingOverrideAlert'
import {
  GATED_PERMIT_TYPES,
  validateOverrideReason,
  type GatedPermitType,
  type PermitTrainingStatusRow,
} from '@soteria/core/permitTrainingGate'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Audited emergency override of the permit training gate. Owner/admin only.
// The row is append-only (no update/delete policy) and audit-logged by
// trigger; this route adds the human half — every owner/admin is emailed
// and any notification channel routed for the event fires.
export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { permit_type?: unknown; permit_id?: unknown; member_ids?: unknown; reason?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const permitType = body.permit_type as GatedPermitType
  const permitId = typeof body.permit_id === 'string' ? body.permit_id : ''
  const memberIds = Array.isArray(body.member_ids) ? body.member_ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id)) : []
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''

  if (!(GATED_PERMIT_TYPES as readonly string[]).includes(permitType) || !UUID_RE.test(permitId)) {
    return NextResponse.json({ error: 'Invalid permit' }, { status: 400 })
  }
  if (memberIds.length === 0 || memberIds.length > 50) return NextResponse.json({ error: 'Choose the workers to override.' }, { status: 400 })
  const reasonProblem = validateOverrideReason(reason)
  if (reasonProblem) return NextResponse.json({ error: reasonProblem }, { status: 422 })

  try {
    const admin = supabaseAdmin()
    const permit = await loadPermitRef(admin, permitType, permitId) ?? pendingPermitRef(permitType, gate.tenantId)
    if (!permit || permit.tenantId !== gate.tenantId) return NextResponse.json({ error: 'Permit not found' }, { status: 404 })

    // Only workers the gate is actually blocking may be overridden, so an
    // override can't be pre-filed for people nobody has checked.
    const { data: status, error: statusErr } = await admin.rpc('permit_training_status', {
      p_tenant_id: gate.tenantId,
      p_permit_type: permitType,
      p_permit_id: permitId,
      p_extra_member_ids: memberIds,
    })
    if (statusErr) throw new Error(statusErr.message)
    const missing = new Map(
      ((status ?? []) as PermitTrainingStatusRow[]).filter(r => r.status === 'missing').map(r => [r.member_id, r.display_name]),
    )
    const notBlocked = memberIds.filter(id => !missing.has(id))
    if (notBlocked.length > 0) {
      return NextResponse.json({ error: 'Only workers currently missing required training can be overridden.' }, { status: 409 })
    }

    const { error: insertErr } = await admin.from('permit_training_overrides').insert({
      tenant_id: gate.tenantId,
      permit_type: permitType,
      permit_id: permitId,
      member_ids: memberIds,
      reason,
      granted_by: gate.userId,
    })
    if (insertErr) throw new Error(insertErr.message)

    const workerNames = memberIds.map(id => missing.get(id) as string)
    await notifyOverride(admin, {
      tenantId: gate.tenantId,
      grantedBy: gate.userId,
      grantedByName: gate.userEmail ?? 'An administrator',
      permitLabel: permit.label,
      permitUrl: `${new URL(req.url).origin}${permit.path}`,
      workerNames,
      reason,
    })

    return NextResponse.json({ overridden: workerNames }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'permits/training-override' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

// Working-at-heights and LOTO group permits are gated at the moment they are
// inserted, so the form pre-generates the permit id and an override has to
// be recorded before the row exists. A stray override for a permit that is
// never created authorizes nothing and stays in the audit trail.
function pendingPermitRef(type: GatedPermitType, tenantId: string): PermitRef | null {
  if (type === 'working_at_heights') return { tenantId, label: 'New working-at-heights permit (being issued)', path: '/admin/working-at-heights/permits' }
  if (type === 'loto_group') return { tenantId, label: 'New LOTO group permit (being issued)', path: '/loto/group-permits' }
  return null
}

async function notifyOverride(
  admin: ReturnType<typeof supabaseAdmin>,
  args: { tenantId: string; grantedBy: string; grantedByName: string; permitLabel: string; permitUrl: string; workerNames: string[]; reason: string },
) {
  // Notification failures must not undo a recorded override; they are
  // logged (email_log, Sentry) and the audit row stands.
  try {
    const [{ data: tenant }, { data: admins }] = await Promise.all([
      admin.from('tenants').select('name').eq('id', args.tenantId).maybeSingle(),
      admin.from('tenant_memberships')
        .select('role, profiles:user_id(email)')
        .eq('tenant_id', args.tenantId)
        .in('role', ['owner', 'admin'])
        .is('invite_cancelled_at', null),
    ])
    const emails = new Set<string>()
    for (const row of (admins ?? []) as { profiles: { email: string | null } | { email: string | null }[] | null }[]) {
      const profiles = Array.isArray(row.profiles) ? row.profiles : [row.profiles]
      for (const p of profiles) if (p?.email) emails.add(p.email)
    }
    await Promise.all([
      ...[...emails].map(to => sendPermitTrainingOverrideAlert({
        to,
        tenantId: args.tenantId,
        tenantName: (tenant?.name as string | undefined) ?? null,
        permitLabel: args.permitLabel,
        permitUrl: args.permitUrl,
        grantedByName: args.grantedByName,
        workerNames: args.workerNames,
        reason: args.reason,
        triggeredBy: args.grantedBy,
      })),
      dispatchNotification({
        tenantId: args.tenantId,
        eventType: 'permit_training_override',
        severity: 'critical',
        subject: `Training override on ${args.permitLabel}`,
        body: `${args.grantedByName} overrode required training for ${args.workerNames.join(', ')}. Reason: ${args.reason}. ${args.permitUrl}`,
      }),
    ])
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'permits/training-override', stage: 'notify' } })
  }
}
