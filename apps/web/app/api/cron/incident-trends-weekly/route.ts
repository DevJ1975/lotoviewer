import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendIncidentTrendsDigest } from '@/lib/email/sendIncidentTrendsDigest'
import {
  trir as trirRate,
  dart as dartRate,
  daysSinceLastRecordable as daysSinceFn,
  type IncidentWithClassification,
  type ClassificationRowForMetrics,
  type IncidentRowForMetrics,
} from '@soteria/core/incidentScorecardMetrics'

// Weekly cron — Mondays. For each tenant, computes a 7-day +
// instantaneous snapshot and emails every owner / admin a digest.
// Vercel schedule: 0 14 * * 1 (Monday 09:00 EST).

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

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)
  const now = new Date()
  const weekStart = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10)
  const yearKey = String(now.getUTCFullYear())

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    const { data: tenants, error: tErr } = await admin
      .from('tenants')
      .select('id, name')
      .is('disabled_at', null)
    if (tErr) throw new Error(tErr.message)
    if (!tenants || tenants.length === 0) {
      return NextResponse.json({ ok: true, sent, skipped, failed, tenants: 0 })
    }

    type T = { id: string; name: string | null }
    for (const t of (tenants as T[])) {
      // Pull per-tenant data in parallel.
      const [incRes, classRes, actionsRes, estRes, mRes] = await Promise.all([
        admin.from('incidents')
          .select('id, incident_type, occurred_at, reported_at, closed_at, shift, severity_actual, status')
          .eq('tenant_id', t.id),
        admin.from('incident_classifications')
          .select('incident_id, meets_recording_criteria, classification')
          .eq('tenant_id', t.id),
        admin.from('incident_actions')
          .select('id, due_at, status')
          .eq('tenant_id', t.id)
          .in('status', ['open', 'in_progress', 'blocked']),
        admin.from('osha_establishments')
          .select('hours_employees_by_year')
          .eq('tenant_id', t.id),
        admin.from('tenant_memberships')
          .select('user_id, role, profiles:profiles!inner(email, full_name)')
          .eq('tenant_id', t.id)
          .in('role', ['owner', 'admin']),
      ])

      if (incRes.error || classRes.error || actionsRes.error || estRes.error || mRes.error) {
        Sentry.captureException(incRes.error ?? classRes.error ?? actionsRes.error ?? estRes.error ?? mRes.error, {
          tags: { route: 'cron/incident-trends-weekly', tenant: t.id },
        })
        skipped++; continue
      }

      const incidents = (incRes.data ?? []) as IncidentRowForMetrics[]
      const classByIncident = new Map<string, ClassificationRowForMetrics>()
      for (const c of (classRes.data ?? []) as ClassificationRowForMetrics[]) {
        classByIncident.set(c.incident_id, c)
      }
      const incidentsJoined: IncidentWithClassification[] = incidents.map(r => ({
        ...r, classification: classByIncident.get(r.id) ?? null,
      }))

      const sevenAgo = now.getTime() - 7 * 86_400_000
      const newIncidents7d = incidents.filter(r => new Date(r.occurred_at).getTime() >= sevenAgo).length
      const newRecordable7d = incidentsJoined.filter(r =>
        r.classification?.meets_recording_criteria === true
        && new Date(r.occurred_at).getTime() >= sevenAgo).length
      const newNearMiss7d = incidents.filter(r =>
        r.incident_type === 'near_miss'
        && new Date(r.occurred_at).getTime() >= sevenAgo).length

      // Critical CAPAs = open + due in ≤7 days OR overdue.
      const cutoff = now.getTime() + 7 * 86_400_000
      type ARow = { id: string; due_at: string | null; status: string }
      const criticalCount = ((actionsRes.data ?? []) as ARow[]).filter(a => {
        if (!a.due_at) return false
        return new Date(a.due_at).getTime() <= cutoff
      }).length

      // Hours worked: sum across the tenant's establishments for the
      // current year.
      type EstYears = { hours_employees_by_year: Record<string, { hours?: number }> | null }
      let hoursWorked = 0
      for (const e of ((estRes.data ?? []) as EstYears[])) {
        const h = e.hours_employees_by_year?.[yearKey]?.hours
        if (typeof h === 'number') hoursWorked += h
      }

      // Snapshot rates (use ALL recordables, not the 7-day window —
      // this is the running rate the program is being judged by).
      const recordablesAll = incidentsJoined.filter(r => r.classification?.meets_recording_criteria)
      const totalRecordable = recordablesAll.length
      const totalDeaths = recordablesAll.filter(r => r.classification?.classification === 'death').length
      const totalDaysAway = recordablesAll.filter(r => r.classification?.classification === 'days_away').length
      const totalRestricted = recordablesAll.filter(r => r.classification?.classification === 'restricted').length

      const snapshotTrir = trirRate(totalRecordable, hoursWorked)
      const snapshotDart = dartRate(totalDeaths, totalDaysAway, totalRestricted, hoursWorked)
      const dsr = daysSinceFn(recordablesAll, now.getTime())

      type MRow = {
        user_id: string
        role: string
        profiles: { email: string | null; full_name: string | null }
                | { email: string | null; full_name: string | null }[]
                | null
      }
      const recipients: Array<{ email: string; full_name: string | null }> = []
      for (const m of (mRes.data ?? []) as MRow[]) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.email) recipients.push({ email: p.email, full_name: p.full_name ?? null })
      }
      if (recipients.length === 0) { skipped++; continue }

      for (const r of recipients) {
        const ok = await sendIncidentTrendsDigest({
          to:                      r.email,
          recipientName:           r.full_name,
          weekStart,
          newIncidents7d,
          newRecordable7d,
          newNearMiss7d,
          openCriticalActions:     criticalCount,
          daysSinceLastRecordable: dsr,
          trir:                    snapshotTrir,
          dart:                    snapshotDart,
          appUrl,
          tenantName:              t.name,
          tenantId:                t.id,
        })
        if (ok) sent++; else failed++
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed, tenants: tenants.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/incident-trends-weekly' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
