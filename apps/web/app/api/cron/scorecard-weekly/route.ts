import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendScorecardWeatherReport } from '@/lib/email/sendScorecardWeatherReport'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'
import { buildWeatherReport, type WeatherMetricInput } from '@soteria/core/scorecardWeatherReport'
import {
  trir as trirRate,
  dart as dartRate,
  type ClassificationRowForMetrics,
} from '@soteria/core/incidentScorecardMetrics'

// Weekly EHS "weather report" cron — Mondays. For each tenant it compares
// this-week vs last-week on the key leading/lagging indicators, adds the
// year-to-date TRIR/DART, and emails every owner/admin.
// Vercel schedule: 30 14 * * 1 (staggered after incident-trends-weekly).

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

const DAY_MS = 86_400_000

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
  const nowMs = now.getTime()
  const thisWeekStart = nowMs - 7 * DAY_MS
  const lastWeekStart = nowMs - 14 * DAY_MS
  const weekStart = new Date(thisWeekStart).toISOString().slice(0, 10)
  const yearStartMs = Date.UTC(now.getUTCFullYear(), 0, 1)
  const yearKey = String(now.getUTCFullYear())

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    // One unsubscribe stream covers every weekly leadership email.
    const suppressed = await loadSuppressedEmails(admin, 'weekly_digest')

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
      const [incRes, classRes, actionsRes, estRes, mRes] = await Promise.all([
        admin.from('incidents')
          .select('id, incident_type, occurred_at')
          .eq('tenant_id', t.id),
        admin.from('incident_classifications')
          .select('incident_id, meets_recording_criteria, classification')
          .eq('tenant_id', t.id),
        admin.from('incident_actions')
          .select('id, status, completed_at')
          .eq('tenant_id', t.id),
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
          tags: { route: 'cron/scorecard-weekly', tenant: t.id },
        })
        skipped++; continue
      }

      type IncRow = { id: string; incident_type: string; occurred_at: string }
      const incidents = (incRes.data ?? []) as IncRow[]
      const recordableIds = new Set(
        ((classRes.data ?? []) as ClassificationRowForMetrics[])
          .filter(c => c.meets_recording_criteria === true)
          .map(c => c.incident_id),
      )

      const inRange = (iso: string, fromMs: number, toMs: number): boolean => {
        const ms = new Date(iso).getTime()
        return !Number.isNaN(ms) && ms >= fromMs && ms < toMs
      }

      // This-week vs last-week leading/lagging counts.
      const recordableThis = incidents.filter(r => recordableIds.has(r.id) && inRange(r.occurred_at, thisWeekStart, nowMs)).length
      const recordableLast = incidents.filter(r => recordableIds.has(r.id) && inRange(r.occurred_at, lastWeekStart, thisWeekStart)).length
      const nearMissThis = incidents.filter(r => r.incident_type === 'near_miss' && inRange(r.occurred_at, thisWeekStart, nowMs)).length
      const nearMissLast = incidents.filter(r => r.incident_type === 'near_miss' && inRange(r.occurred_at, lastWeekStart, thisWeekStart)).length

      type ARow = { id: string; status: string; completed_at: string | null }
      const isClosed = (a: ARow) => (a.status === 'complete' || a.status === 'verified') && !!a.completed_at
      const actions = (actionsRes.data ?? []) as ARow[]
      const capasThis = actions.filter(a => isClosed(a) && inRange(a.completed_at!, thisWeekStart, nowMs)).length
      const capasLast = actions.filter(a => isClosed(a) && inRange(a.completed_at!, lastWeekStart, thisWeekStart)).length

      const inputs: WeatherMetricInput[] = [
        { key: 'recordables', label: 'Recordable injuries', current: recordableThis, previous: recordableLast, higherIsBetter: false },
        { key: 'near_miss', label: 'Near-miss reports', current: nearMissThis, previous: nearMissLast, higherIsBetter: true },
        { key: 'capas_closed', label: 'Corrective actions closed', current: capasThis, previous: capasLast, higherIsBetter: true },
      ]
      const rows = buildWeatherReport(inputs)

      // Year-to-date TRIR/DART: recordables this calendar year over the
      // current year's hours-worked denominator.
      const classById = new Map<string, ClassificationRowForMetrics>()
      for (const c of (classRes.data ?? []) as ClassificationRowForMetrics[]) classById.set(c.incident_id, c)
      const recordablesYtd = incidents.filter(r => recordableIds.has(r.id) && inRange(r.occurred_at, yearStartMs, nowMs))
      const ytdDeaths = recordablesYtd.filter(r => classById.get(r.id)?.classification === 'death').length
      const ytdDaysAway = recordablesYtd.filter(r => classById.get(r.id)?.classification === 'days_away').length
      const ytdRestricted = recordablesYtd.filter(r => classById.get(r.id)?.classification === 'restricted').length

      type EstYears = { hours_employees_by_year: Record<string, { hours?: number }> | null }
      let hoursWorked = 0
      for (const e of ((estRes.data ?? []) as EstYears[])) {
        const h = e.hours_employees_by_year?.[yearKey]?.hours
        if (typeof h === 'number') hoursWorked += h
      }

      const trir = trirRate(recordablesYtd.length, hoursWorked)
      const dart = dartRate(ytdDeaths, ytdDaysAway, ytdRestricted, hoursWorked)

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
        if (p?.email && !suppressed.has(p.email.toLowerCase())) {
          recipients.push({ email: p.email, full_name: p.full_name ?? null })
        }
      }
      if (recipients.length === 0) { skipped++; continue }

      for (const r of recipients) {
        const { sent: ok } = await sendScorecardWeatherReport({
          to:             r.email,
          recipientName:  r.full_name,
          weekStart,
          rows,
          trir,
          dart,
          appUrl,
          tenantName:     t.name,
          tenantId:       t.id,
          unsubscribeUrl: buildUnsubscribe(appUrl, r.email, 'weekly_digest')?.url ?? null,
        })
        if (ok) sent++; else failed++
      }
    }

    return NextResponse.json({ ok: true, sent, skipped, failed, tenants: tenants.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/scorecard-weekly' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
