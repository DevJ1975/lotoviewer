import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  sendRiskReviewReminder,
  type OverdueRiskRow,
} from '@/lib/email/sendRiskReviewReminder'
import { bandFor } from '@soteria/core/risk'

// Daily review-cadence cron.
//
// Finds every risk where:
//   - status not in ('closed', 'accepted_exception')
//   - next_review_date < today
//   - assigned_to is not null (no owner = nobody to email)
//
// Groups by (tenant_id, assigned_to) and emails one digest per
// owner with all of their overdue risks listed inline (PDD §6.3).
//
// Auth: Bearer CRON_SECRET (Vercel scheduled invocation) OR
//       x-internal-secret INTERNAL_PUSH_SECRET (manual curl).
//       Same pattern as the daily-health-report + meter-bump
//       reminders crons.
//
// Vercel schedule: 0 13 * * * (08:00 EST / 09:00 EDT, the closest
// single-cron approximation of "9am Eastern" without DST
// gymnastics — caught early enough that owners can review the
// same business day).

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

interface RiskRow {
  id:                   string
  tenant_id:            string
  risk_number:          string
  title:                string
  inherent_band:        ReturnType<typeof bandFor>
  residual_band:        ReturnType<typeof bandFor> | null
  next_review_date:     string
  assigned_to:          string
}

// Shape of the JSON body this cron returns. Both the early-exit
// (no overdues) and the main path use this same set of four keys
// so consumers (Vercel cron dashboard, smoke-test curl,
// monitoring) see a stable contract regardless of overdue count.
interface CronResponse {
  overdue:         number
  ownersNotified:  number
  emailsSent:      number
  emailsSkipped:   number
}

export async function GET(req: Request)  { return run(req) }
export async function POST(req: Request) { return run(req) }

async function run(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const todayIso = new Date().toISOString().slice(0, 10)
  const baseUrl  = publicAppUrl(req)

  // ─── Pull overdue risks across all tenants (service-role) ──────────────
  const { data: rows, error } = await admin
    .from('risks')
    .select('id, tenant_id, risk_number, title, inherent_band, residual_band, next_review_date, assigned_to')
    .lt('next_review_date', todayIso)
    .not('assigned_to', 'is', null)
    .not('status', 'in', '("closed","accepted_exception")')
  if (error) {
    Sentry.captureException(error, { tags: { route: 'cron/risk-review-reminders' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!rows || rows.length === 0) {
    const empty: CronResponse = { overdue: 0, ownersNotified: 0, emailsSent: 0, emailsSkipped: 0 }
    return NextResponse.json(empty)
  }

  // ─── Resolve tenant names + owner emails ────────────────────────────────
  const tenantIds = [...new Set(rows.map(r => r.tenant_id))]
  const ownerIds  = [...new Set(rows.map(r => r.assigned_to as string))]

  const [{ data: tenants }, { data: usersList }] = await Promise.all([
    admin.from('tenants').select('id, name').in('id', tenantIds),
    admin.auth.admin.listUsers({ perPage: 1000 }),
  ])
  // profiles.full_name lookup batched the same way.
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', ownerIds)

  const tenantNameById = new Map((tenants ?? []).map(t => [t.id, t.name]))
  const emailById      = new Map((usersList?.users ?? []).map(u => [u.id, u.email ?? null]))
  const fullNameById   = new Map((profiles ?? []).map(p => [p.id, p.full_name ?? null]))

  // ─── Group by (tenant_id, owner) and build email payloads ──────────────
  type GroupKey = string                     // `${tenantId}:${ownerId}`
  const groups = new Map<GroupKey, OverdueRiskRow[]>()
  const ownerCtx = new Map<GroupKey, { ownerId: string; tenantName: string }>()

  for (const r of (rows as RiskRow[])) {
    const key = `${r.tenant_id}:${r.assigned_to}`
    if (!groups.has(key)) groups.set(key, [])
    const band = (r.residual_band ?? r.inherent_band)
    const reviewDate = r.next_review_date
    const days_overdue = Math.max(1, Math.floor(
      (Date.parse(todayIso) - Date.parse(reviewDate)) / 86_400_000,
    ))
    groups.get(key)!.push({
      risk_number:      r.risk_number,
      title:            r.title,
      effective_band:   band,
      next_review_date: reviewDate,
      days_overdue,
      detail_url:       `${baseUrl}/risk/${r.id}`,
    })
    ownerCtx.set(key, {
      ownerId:    r.assigned_to,
      tenantName: tenantNameById.get(r.tenant_id) ?? 'your tenant',
    })
  }

  // Sort each owner's list by band severity desc → days_overdue desc
  // so the most urgent sits at the top of the email.
  const BAND_RANK = { extreme: 4, high: 3, moderate: 2, low: 1 } as const
  for (const list of groups.values()) {
    list.sort((a, b) => {
      const bandDiff = BAND_RANK[b.effective_band] - BAND_RANK[a.effective_band]
      if (bandDiff !== 0) return bandDiff
      return b.days_overdue - a.days_overdue
    })
  }

  // ─── Send one email per group via Promise.allSettled ───────────────────
  let sentCount = 0
  let skipCount = 0
  await Promise.all([...groups.entries()].map(async ([key, risks]) => {
    const ctx = ownerCtx.get(key)!
    const email = emailById.get(ctx.ownerId)
    if (!email) {
      skipCount += 1
      return
    }
    const result = await sendRiskReviewReminder({
      to:           email,
      reviewerName: fullNameById.get(ctx.ownerId) ?? '',
      tenantName:   ctx.tenantName,
      risks,
    })
    if (result.sent) sentCount += 1
    else             skipCount += 1
  }))

  const result: CronResponse = {
    overdue:        rows.length,
    ownersNotified: groups.size,
    emailsSent:     sentCount,
    emailsSkipped:  skipCount,
  }
  return NextResponse.json(result)
}
