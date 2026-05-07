import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendCareCheckInEmail } from '@/lib/email/sendCareCheckIn'
import {
  type CareCaseStatus,
} from '@soteria/core/incidentCare'

// Daily cron: incident-care-followup.
//
// Finds care cases where:
//   - case_status is 'open' or 'modified_duty' (i.e. still active)
//   - next_followup_at is set and ≤ now
//
// For each matching case, emails the case_manager_user_id (if set)
// or all tenant admins (fallback). The case manager updates
// next_followup_at when they log a visit, which removes the row
// from tomorrow's pull.
//
// Vercel schedule: 30 13 * * * (08:30 EST — runs after the action
// reminders cron so the case manager doesn't get hit with two
// emails at the same minute).

export const runtime = 'nodejs'

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

interface CareRow {
  id:                    string
  tenant_id:             string
  incident_id:           string
  person_id:             string | null
  case_status:           CareCaseStatus
  next_followup_at:      string | null
  case_manager_user_id:  string | null
  created_at:            string
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)
  const now = new Date()
  const nowIso = now.toISOString()

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    const { data: cases, error } = await admin
      .from('incident_care_cases')
      .select('id, tenant_id, incident_id, person_id, case_status, next_followup_at, case_manager_user_id, created_at')
      .in('case_status', ['open', 'modified_duty'])
      .not('next_followup_at', 'is', null)
      .lte('next_followup_at', nowIso)
    if (error) throw new Error(error.message)
    if (!cases || cases.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0, candidates: 0 })
    }

    const rows = cases as CareRow[]

    const tenantCache = new Map<string, string | null>()
    const incidentCache = new Map<string, { report_number: string }>()
    const personCache = new Map<string, string | null>()
    const adminEmailsCache = new Map<string, Array<{ user_id: string; email: string; full_name: string | null }>>()

    async function getTenantName(id: string): Promise<string | null> {
      if (tenantCache.has(id)) return tenantCache.get(id) ?? null
      const { data } = await admin.from('tenants').select('name').eq('id', id).maybeSingle()
      const v = (data as { name?: string | null } | null)?.name ?? null
      tenantCache.set(id, v); return v
    }
    async function getIncident(id: string) {
      const cached = incidentCache.get(id); if (cached) return cached
      const { data } = await admin.from('incidents').select('report_number').eq('id', id).maybeSingle()
      const v = (data ?? { report_number: '?' }) as { report_number: string }
      incidentCache.set(id, v); return v
    }
    async function getInjuredName(personId: string | null): Promise<string | null> {
      if (!personId) return null
      const cached = personCache.get(personId)
      if (cached !== undefined) return cached
      const { data } = await admin
        .from('incident_people_safe')
        .select('full_name')
        .eq('id', personId)
        .maybeSingle()
      const v = (data as { full_name?: string | null } | null)?.full_name ?? null
      personCache.set(personId, v); return v
    }
    async function getAdmins(tenantId: string) {
      const cached = adminEmailsCache.get(tenantId)
      if (cached) return cached
      const { data } = await admin
        .from('tenant_memberships')
        .select('user_id, role, profiles:profiles!inner(email, full_name)')
        .eq('tenant_id', tenantId)
        .in('role', ['owner', 'admin'])
      type Row = {
        user_id: string
        role: string
        profiles: { email: string | null; full_name: string | null }
                | { email: string | null; full_name: string | null }[]
                | null
      }
      const out: Array<{ user_id: string; email: string; full_name: string | null }> = []
      for (const m of (data ?? []) as Row[]) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.email) out.push({ user_id: m.user_id, email: p.email, full_name: p.full_name ?? null })
      }
      adminEmailsCache.set(tenantId, out)
      return out
    }

    for (const c of rows) {
      const incident = await getIncident(c.incident_id)
      const tenantName = await getTenantName(c.tenant_id)
      const injuredName = await getInjuredName(c.person_id)
      const daysOpen = Math.max(0, Math.floor((now.getTime() - new Date(c.created_at).getTime()) / 86_400_000))

      // Audience: case manager if set; else all tenant admins.
      let recipients: Array<{ email: string; full_name: string | null; user_id: string | null }> = []
      if (c.case_manager_user_id) {
        const { data: mgr } = await admin
          .from('profiles')
          .select('email, full_name')
          .eq('id', c.case_manager_user_id)
          .maybeSingle()
        const m = mgr as { email: string | null; full_name: string | null } | null
        if (m?.email) recipients.push({ email: m.email, full_name: m.full_name, user_id: c.case_manager_user_id })
      } else {
        const admins = await getAdmins(c.tenant_id)
        recipients = admins.map(a => ({ email: a.email, full_name: a.full_name, user_id: a.user_id }))
      }

      if (recipients.length === 0) { skipped++; continue }

      for (const r of recipients) {
        const ok = await sendCareCheckInEmail({
          to:             r.email,
          recipientName:  r.full_name,
          reportNumber:   incident.report_number,
          incidentId:     c.incident_id,
          caseId:         c.id,
          caseStatus:     c.case_status,
          injuredName,
          daysOpen,
          appUrl,
          tenantName,
          tenantId:       c.tenant_id,
        })
        if (ok) sent++; else failed++
      }
    }

    return NextResponse.json({
      ok: true, sent, skipped, failed, candidates: rows.length,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/incident-care-followup' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
