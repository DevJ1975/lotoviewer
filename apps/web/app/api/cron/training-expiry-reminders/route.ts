import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { buildExpiryDigest, type RawTrainingRow } from '@soteria/core/trainingExpiryDigest'
import { sendTrainingExpiryReminder } from '@/lib/email/sendTrainingExpiryReminder'
import type { TrainingRole } from '@soteria/core/types'

// Daily training-expiry reminder cron.
//
// Pulls every loto_training_records row, runs them through
// buildExpiryDigest() (drops not-expiring + drops expired-too-long-
// ago), groups by tenant, and emails the digest to every tenant
// admin / owner.
//
// Auth: Bearer CRON_SECRET (Vercel scheduled invocation) OR
//       x-internal-secret INTERNAL_PUSH_SECRET (manual curl).
//       Same posture as the other crons under /api/cron/.
//
// Vercel schedule: 0 12 * * * (07:00 EST / 08:00 EDT — start of
// shift, before any locktags get issued for the day).

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

interface AdminRecipient {
  user_id:    string
  email:      string
  full_name:  string | null
  tenant_id:  string
}

export async function GET(req: Request)  { return runCron(req) }
export async function POST(req: Request) { return runCron(req) }

async function runCron(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)

  try {
    // 1. Pull every training record with a tenant_id + expiry. The
    //    table is small (one row per worker per cert event) so a
    //    full scan is fine; the digest helper trims to the relevant
    //    window.
    const { data: trainingRows, error: tErr } = await admin
      .from('loto_training_records')
      .select('tenant_id, worker_name, role, expires_at, completed_at')
      .not('expires_at', 'is', null)
    if (tErr) {
      Sentry.captureException(tErr, { tags: { route: '/api/cron/training-expiry-reminders', stage: 'fetch' } })
      return NextResponse.json({ error: tErr.message }, { status: 500 })
    }

    const raw: RawTrainingRow[] = (trainingRows ?? [])
      .filter((r): r is { tenant_id: string; worker_name: string; role: string; expires_at: string; completed_at: string } =>
        !!r.tenant_id && !!r.worker_name && !!r.role && !!r.expires_at && !!r.completed_at,
      )
      .map(r => ({
        tenant_id:    r.tenant_id,
        worker_name:  r.worker_name,
        role:         r.role as TrainingRole,
        expires_at:   r.expires_at,
        completed_at: r.completed_at,
      }))

    const digests = buildExpiryDigest(raw)
    if (digests.length === 0) {
      return NextResponse.json({ tenants_scanned: 0, emails_sent: 0, message: 'No training records in the alert window.' })
    }

    // 2. Resolve admin recipients per tenant (owner or admin role).
    //    Single query for all relevant tenants — cheaper than
    //    per-tenant round-trips.
    const tenantIds = digests.map(d => d.tenant_id)
    const { data: memberships, error: mErr } = await admin
      .from('tenant_memberships')
      .select('user_id, tenant_id, role')
      .in('tenant_id', tenantIds)
      .in('role', ['owner', 'admin'])
    if (mErr) {
      Sentry.captureException(mErr, { tags: { route: '/api/cron/training-expiry-reminders', stage: 'memberships' } })
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }

    const adminUserIds = Array.from(new Set((memberships ?? []).map(m => m.user_id)))
    if (adminUserIds.length === 0) {
      return NextResponse.json({ tenants_scanned: digests.length, emails_sent: 0, message: 'No tenant admins found.' })
    }

    // 3. Resolve emails + full_names for those user_ids.
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', adminUserIds)
    const profileById = new Map<string, { email: string | null; full_name: string | null }>()
    for (const p of profiles ?? []) profileById.set(p.id as string, { email: p.email as string | null, full_name: p.full_name as string | null })

    // 4. Resolve tenant names for the email subject + body.
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, name')
      .in('id', tenantIds)
    const tenantNameById = new Map<string, string>()
    for (const t of tenants ?? []) tenantNameById.set(t.id as string, t.name as string)

    // 5. Build (tenant, admin) recipient pairs.
    const recipients: AdminRecipient[] = []
    for (const m of memberships ?? []) {
      const prof = profileById.get(m.user_id as string)
      if (!prof?.email) continue
      recipients.push({
        user_id:   m.user_id as string,
        email:     prof.email,
        full_name: prof.full_name,
        tenant_id: m.tenant_id as string,
      })
    }

    // 6. Fan out one email per (tenant, admin). Use Promise.allSettled
    //    so a single Resend failure doesn't sink the whole batch.
    const trainingUrl = `${appUrl}/admin/training-records`
    const workersUrl  = `${appUrl}/admin/workers`

    const results = await Promise.allSettled(
      recipients.map(r => {
        const digest = digests.find(d => d.tenant_id === r.tenant_id)
        if (!digest) return Promise.resolve({ sent: false, providerId: null })
        return sendTrainingExpiryReminder({
          to:           r.email,
          reviewerName: r.full_name ?? '',
          tenantName:   tenantNameById.get(r.tenant_id) ?? 'your tenant',
          rows:         digest.rows,
          trainingUrl,
          workersUrl,
        })
      }),
    )
    const sent = results.filter(r => r.status === 'fulfilled' && r.value.sent).length
    const failed = results.length - sent

    return NextResponse.json({
      tenants_scanned: digests.length,
      recipients:      recipients.length,
      emails_sent:     sent,
      emails_failed:   failed,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/training-expiry-reminders' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
