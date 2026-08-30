import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'

export const runtime = 'nodejs'
// One unbounded loto_equipment query per active rule across every tenant, so
// the read count grows with tenants × rules. The notification writes are
// batched; the reads are not, which is what needs the full ceiling.
export const maxDuration = 300

// PostgREST carries the whole batch in one request body; 500 rows keeps that
// body a sane size while still collapsing a many-tenant sweep into a handful of
// round-trips. The same cap bounds the id list in the rule-stamp filter, which
// travels in the query string.
const WRITE_CHUNK = 500

interface AdminNotification {
  tenant_id: string
  user_id:   string
  title:     string
  body:      string
  href:      string
}

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
  // The sweep is tenants x rules x admins. Writing inside it meant one insert
  // per admin per rule; accumulate instead and write once the sweep is done.
  const notifications: AdminNotification[] = []
  const remindedRuleIds: string[] = []

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
          notifications.push({
            tenant_id: tenantId,
            user_id: userId,
            title: 'Equipment inspections overdue',
            body: `${missed.length} ${rule.shift_label ?? 'daily'} equipment pre-use checks appear overdue.`,
            href: '/equipment-readiness',
          })
        }
        remindedRuleIds.push(rule.id as string)
      }
    }

    for (let i = 0; i < notifications.length; i += WRITE_CHUNK) {
      const chunk = notifications.slice(i, i + WRITE_CHUNK)
      const { error: notificationErr } = await admin.from('notifications').insert(chunk)
      if (notificationErr) {
        // A failed chunk is not fatal — the remaining chunks and the
        // authorization scan below still have value — but it silently costs
        // admins their reminders, so it has to reach Sentry.
        Sentry.captureException(notificationErr, {
          tags: { route: 'cron/equipment-readiness-reminders', stage: 'notifications' },
        })
        continue
      }
      alerts += chunk.length
    }

    // Every rule touched this run gets the same timestamps, so the per-rule
    // update collapses into one statement per chunk.
    const stampedAt = now.toISOString()
    for (let i = 0; i < remindedRuleIds.length; i += WRITE_CHUNK) {
      const { error: stampErr } = await admin
        .from('equipment_missed_inspection_rules')
        .update({ last_reminded_at: stampedAt, updated_at: stampedAt })
        .in('id', remindedRuleIds.slice(i, i + WRITE_CHUNK))
      if (stampErr) {
        Sentry.captureException(stampErr, {
          tags: { route: 'cron/equipment-readiness-reminders', stage: 'rule-stamp' },
        })
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
