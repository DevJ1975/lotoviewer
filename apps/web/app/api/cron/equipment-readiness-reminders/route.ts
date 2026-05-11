import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'

export const runtime = 'nodejs'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret && bearer && safeEqual(bearer, cronSecret)) return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer && safeEqual(bearer, internalSecret)) return true
  return false
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const now = new Date()
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  let alerts = 0
  let overdueEquipment = 0
  let overdueAuthorizations = 0

  try {
    const { data: rules, error: ruleErr } = await admin
      .from('equipment_missed_inspection_rules')
      .select('id,tenant_id,equipment_family,department,shift_label,grace_minutes,last_reminded_at')
      .eq('active', true)
    if (ruleErr) throw ruleErr

    const tenantIds = [...new Set((rules ?? []).map(row => row.tenant_id as string))]
    for (const tenantId of tenantIds) {
      const tenantRules = (rules ?? []).filter(row => row.tenant_id === tenantId)
      const { data: admins } = await admin
        .from('tenant_memberships')
        .select('user_id')
        .eq('tenant_id', tenantId)
        .in('role', ['owner', 'admin'])
      const adminIds = (admins ?? []).map(row => row.user_id as string)
      if (adminIds.length === 0) continue

      for (const rule of tenantRules) {
        let equipmentQuery = admin
          .from('loto_equipment')
          .select('id,equipment_id,description,department,equipment_family,last_pre_use_inspection_at,readiness_status')
          .eq('tenant_id', tenantId)
          .eq('decommissioned', false)
        if (rule.equipment_family) equipmentQuery = equipmentQuery.eq('equipment_family', rule.equipment_family as string)
        if (rule.department) equipmentQuery = equipmentQuery.eq('department', rule.department as string)
        const { data: equipment, error: equipmentErr } = await equipmentQuery
        if (equipmentErr) throw equipmentErr
        const missed = (equipment ?? []).filter(row => {
          const last = row.last_pre_use_inspection_at as string | null
          return !last || last < yesterday
        })
        overdueEquipment += missed.length
        if (missed.length === 0) continue

        for (const userId of adminIds) {
          const { error: notificationErr } = await admin.from('notifications').insert({
            tenant_id: tenantId,
            user_id: userId,
            title: 'Equipment inspections overdue',
            body: `${missed.length} ${rule.shift_label ?? 'daily'} equipment pre-use checks appear overdue.`,
            href: '/equipment-readiness',
          })
          if (!notificationErr) alerts += 1
        }
        await admin
          .from('equipment_missed_inspection_rules')
          .update({ last_reminded_at: now.toISOString(), updated_at: now.toISOString() })
          .eq('id', rule.id)
      }
    }

    const due = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const { data: authRows, error: authErr } = await admin
      .from('equipment_operator_authorizations')
      .select('id,tenant_id,user_id,equipment_family,evaluation_due_at,expires_at')
      .eq('status', 'active')
      .or(`evaluation_due_at.lte.${due},expires_at.lte.${due}`)
    if (authErr) throw authErr
    overdueAuthorizations = authRows?.length ?? 0

    return NextResponse.json({ ok: true, alerts, overdue_equipment: overdueEquipment, expiring_authorizations: overdueAuthorizations })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: 'cron/equipment-readiness-reminders' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Cron failed.' }, { status: 500 })
  }
}
