import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendOshaPostingReminder } from '@/lib/email/sendOshaPostingReminder'

// Cron: osha-300a-posting-prompt.
//
// Runs once a year on Jan 15 (or any time it's invoked manually).
// For each tenant with at least one establishment, finds
// establishments whose 300A for last year hasn't been certified yet,
// and emails each tenant admin with the list.
//
// Idempotency: we don't mark "already sent" — re-running on Jan 15
// 09:00 vs 09:05 is harmless. A future enhancement could add an
// `osha_posting_reminders_sent` table; Phase 4 keeps it simple.
//
// Vercel schedule: 0 14 15 1 * (Jan 15 09:00 EST).

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
  const url = new URL(req.url)
  const overrideYear = parseInt(url.searchParams.get('year') ?? '', 10)
  const reportingYear = Number.isInteger(overrideYear) ? overrideYear : (new Date().getFullYear() - 1)

  let sent = 0
  let skipped = 0
  let failed = 0

  try {
    // Group establishments by tenant.
    const { data: ests, error: estErr } = await admin
      .from('osha_establishments')
      .select('id, tenant_id, establishment_name')
    if (estErr) throw new Error(estErr.message)
    if (!ests || ests.length === 0) {
      return NextResponse.json({ ok: true, sent: 0, skipped: 0, failed: 0, tenants: 0 })
    }

    type Est = { id: string; tenant_id: string; establishment_name: string }
    const byTenant = new Map<string, Est[]>()
    for (const e of ests as Est[]) {
      const list = byTenant.get(e.tenant_id) ?? []
      list.push(e)
      byTenant.set(e.tenant_id, list)
    }

    for (const [tenantId, tenantEsts] of byTenant.entries()) {
      // Resolve which establishments are already certified for the
      // reporting year.
      const { data: certs } = await admin
        .from('osha_annual_summaries')
        .select('establishment_id, certified_at')
        .eq('tenant_id', tenantId)
        .eq('year', reportingYear)
      const certifiedIds = new Set<string>(
        ((certs ?? []) as Array<{ establishment_id: string; certified_at: string | null }>)
          .filter(c => c.certified_at)
          .map(c => c.establishment_id),
      )
      const awaiting = tenantEsts
        .filter(e => !certifiedIds.has(e.id))
        .map(e => e.establishment_name)

      // Tenant admins.
      const { data: members } = await admin
        .from('tenant_memberships')
        .select('user_id, role, profiles:profiles!inner(email, full_name)')
        .eq('tenant_id', tenantId)
        .in('role', ['owner', 'admin'])
      type MRow = {
        user_id: string
        role: string
        profiles: { email: string | null; full_name: string | null }
                | { email: string | null; full_name: string | null }[]
                | null
      }
      const recipients: Array<{ email: string; full_name: string | null }> = []
      for (const m of (members ?? []) as MRow[]) {
        const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
        if (p?.email) recipients.push({ email: p.email, full_name: p.full_name ?? null })
      }
      if (recipients.length === 0) { skipped++; continue }

      const { data: tenant } = await admin
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .maybeSingle()
      const tenantName = (tenant as { name?: string | null } | null)?.name ?? null

      for (const r of recipients) {
        const ok = await sendOshaPostingReminder({
          to:                 r.email,
          recipientName:      r.full_name,
          year:               reportingYear,
          establishmentNames: awaiting,
          appUrl,
          tenantName,
          tenantId,
        })
        if (ok) sent++; else failed++
      }
    }

    return NextResponse.json({
      ok: true, sent, skipped, failed,
      tenants: byTenant.size, year: reportingYear,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron/osha-300a-posting-prompt' } })
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
