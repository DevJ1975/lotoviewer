import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendActionReminderEmail } from '@/lib/email/sendActionReminder'
import {
  type IncidentActionType,
} from '@soteria/core/incidentAction'

// Daily cron: incident-action-reminders.
//
// Finds CAPAs that are open / in_progress / blocked AND have a
// due_at within the alert window:
//   - overdue:  due_at < now
//   - due soon: due_at within the next 3 days
//
// For each matching action, emails the owner_user_id (if any). No
// reminder if the action has no owner — admins see open actions on
// the home OpenActionsPanel anyway.
//
// Idempotency: the cron runs once per day. We don't track per-action
// "last reminded" timestamps in Phase 3 — a daily nudge is fine. A
// future enhancement could throttle to one reminder per overdue
// week.
//
// Vercel schedule: 0 13 * * * (08:00 EST — start of US business day).

export const runtime = 'nodejs'

const REMINDER_WINDOW_DAYS = 3

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function GET(req: Request)  {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

interface ActionRow {
  id:                    string
  tenant_id:             string
  incident_id:           string
  description:           string
  action_type:           IncidentActionType
  owner_user_id:         string | null
  due_at:                string | null
  status:                string
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)

  const now    = new Date()
  const cutoff = new Date(now.getTime() + REMINDER_WINDOW_DAYS * 86_400_000).toISOString()

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    const { data: actions, error } = await admin
      .from('incident_actions')
      .select('id, tenant_id, incident_id, description, action_type, owner_user_id, due_at, status')
      .in('status', ['open', 'in_progress', 'blocked'])
      .not('due_at', 'is', null)
      .lte('due_at', cutoff)
      .not('owner_user_id', 'is', null)
    if (error) throw new Error(error.message)
    if (!actions || actions.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0, candidates: 0 })
    }

    const rows = actions as ActionRow[]

    // Cache per-tenant context (tenant name) and per-user owner data.
    const tenantCache = new Map<string, string | null>()
    const ownerCache  = new Map<string, { email: string | null; full_name: string | null }>()
    const incidentCache = new Map<string, { report_number: string; tenant_id: string }>()

    async function getTenantName(tenantId: string): Promise<string | null> {
      if (tenantCache.has(tenantId)) return tenantCache.get(tenantId) ?? null
      const { data } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle()
      const name = (data as { name?: string | null } | null)?.name ?? null
      tenantCache.set(tenantId, name)
      return name
    }
    async function getOwner(userId: string) {
      const cached = ownerCache.get(userId)
      if (cached) return cached
      const { data } = await admin
        .from('profiles')
        .select('email, full_name')
        .eq('id', userId)
        .maybeSingle()
      const v = (data ?? { email: null, full_name: null }) as { email: string | null; full_name: string | null }
      ownerCache.set(userId, v)
      return v
    }
    async function getIncident(incidentId: string) {
      const cached = incidentCache.get(incidentId)
      if (cached) return cached
      const { data } = await admin
        .from('incidents')
        .select('report_number, tenant_id')
        .eq('id', incidentId)
        .maybeSingle()
      const v = (data ?? { report_number: '?', tenant_id: '' }) as { report_number: string; tenant_id: string }
      incidentCache.set(incidentId, v)
      return v
    }

    for (const a of rows) {
      if (!a.owner_user_id || !a.due_at) { skipped++; continue }

      const owner = await getOwner(a.owner_user_id)
      if (!owner.email) { skipped++; continue }

      const incident = await getIncident(a.incident_id)
      const tenantName = await getTenantName(a.tenant_id)

      const dueMs = new Date(a.due_at).getTime()
      const daysOverdue = Math.ceil((now.getTime() - dueMs) / 86_400_000)

      const ok = await sendActionReminderEmail({
        to:             owner.email,
        recipientName:  owner.full_name,
        reportNumber:   incident.report_number,
        incidentId:     a.incident_id,
        actionId:       a.id,
        description:    a.description,
        actionType:     a.action_type,
        dueAt:          a.due_at,
        daysOverdue,
        appUrl,
        tenantName,
        tenantId:       a.tenant_id,
      })
      if (ok) sent++; else failed++
    }

    return NextResponse.json({
      ok: true, sent, skipped, failed, candidates: rows.length,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/incident-action-reminders' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
