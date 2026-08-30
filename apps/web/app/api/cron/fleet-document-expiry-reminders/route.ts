import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import {
  buildFleetExpiryDigest,
  EXPIRING_WINDOW_DAYS,
  EXPIRED_GRACE_DAYS,
  type RawExpiryRow,
  type FleetExpiryKind,
} from '@soteria/core/fleetExpiry'
import { sendFleetExpiryReminder } from '@/lib/email/sendFleetExpiryReminder'
import { loadSuppressedEmails } from '@/lib/email/suppression'
import { buildUnsubscribe } from '@/lib/email/unsubscribe'

// Daily fleet credential/document expiry reminder cron.
//
// Pulls driver licenses / DOT medical cards / hazmat endorsements and vehicle
// documents whose expiry falls in the alert window, runs them through
// buildFleetExpiryDigest (drops out-of-window + groups by tenant), and emails
// the digest to every tenant owner/admin. Same auth + logging posture as the
// other crons under /api/cron/.

export const runtime = 'nodejs'
// Multi-tenant email fan-out: one digest per tenant owner/admin. Runtime tracks
// the recipient count, not the size of any single query.
export const maxDuration = 300

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

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

const DOC_KIND: Record<string, FleetExpiryKind> = {
  insurance:      'vehicle_insurance',
  registration:   'vehicle_registration',
  dot_inspection: 'vehicle_dot_inspection',
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)

  const now = new Date()
  const lo = new Date(now.getTime() - EXPIRED_GRACE_DAYS  * 86400000).toISOString().slice(0, 10)
  const hi = new Date(now.getTime() + EXPIRING_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)

  try {
    const raw: RawExpiryRow[] = []

    // 1. Driver credentials — license / medical / hazmat endorsement.
    const inWindow = (col: string) => `and(${col}.gte.${lo},${col}.lte.${hi})`
    const { data: drivers, error: dErr } = await admin
      .from('fleet_driver_profiles')
      .select('id, tenant_id, status, license_expires_at, medical_card_expires_at, hazmat_endorsement_expires_at, loto_workers(full_name)')
      .neq('status', 'inactive')
      .or([
        inWindow('license_expires_at'),
        inWindow('medical_card_expires_at'),
        inWindow('hazmat_endorsement_expires_at'),
      ].join(','))
    if (dErr) {
      Sentry.captureException(dErr, { tags: { route: '/api/cron/fleet-document-expiry-reminders', stage: 'drivers' } })
      return NextResponse.json({ error: dErr.message }, { status: 500 })
    }
    for (const d of drivers ?? []) {
      const worker = (d as { loto_workers?: { full_name?: string } | null }).loto_workers
      const subject = worker?.full_name?.trim() || 'Driver'
      const base = { tenant_id: d.tenant_id as string, subject, subject_kind: 'driver' as const, subject_id: d.id as string }
      if (d.license_expires_at)            raw.push({ ...base, kind: 'driver_license', expires_at: d.license_expires_at as string })
      if (d.medical_card_expires_at)       raw.push({ ...base, kind: 'driver_medical', expires_at: d.medical_card_expires_at as string })
      if (d.hazmat_endorsement_expires_at) raw.push({ ...base, kind: 'driver_hazmat',  expires_at: d.hazmat_endorsement_expires_at as string })
    }

    // 2. Vehicle documents — insurance / registration / DOT inspection / …
    const { data: docs, error: docErr } = await admin
      .from('fleet_vehicle_documents')
      .select('id, tenant_id, doc_type, expires_at, vehicle_id, fleet_vehicles(unit_number, make, model)')
      .not('expires_at', 'is', null)
      .gte('expires_at', lo)
      .lte('expires_at', hi)
    if (docErr) {
      Sentry.captureException(docErr, { tags: { route: '/api/cron/fleet-document-expiry-reminders', stage: 'documents' } })
      return NextResponse.json({ error: docErr.message }, { status: 500 })
    }
    for (const doc of docs ?? []) {
      const v = (doc as { fleet_vehicles?: { unit_number?: string | null; make?: string | null; model?: string | null } | null }).fleet_vehicles
      const subject = v?.unit_number?.trim()
        || [v?.make, v?.model].filter(Boolean).join(' ').trim()
        || 'Vehicle'
      raw.push({
        tenant_id:    doc.tenant_id as string,
        kind:         DOC_KIND[doc.doc_type as string] ?? 'vehicle_document',
        subject,
        subject_kind: 'vehicle',
        subject_id:   doc.vehicle_id as string,
        expires_at:   doc.expires_at as string,
      })
    }

    const digests = buildFleetExpiryDigest(raw, now)
    if (digests.length === 0) {
      return NextResponse.json({ tenants_scanned: 0, emails_sent: 0, message: 'No fleet records in the alert window.' })
    }

    // 3. Resolve owner/admin recipients per tenant.
    const tenantIds = digests.map(d => d.tenant_id)
    const { data: memberships } = await admin
      .from('tenant_memberships')
      .select('user_id, tenant_id, role')
      .in('tenant_id', tenantIds)
      .in('role', ['owner', 'admin'])

    const adminUserIds = Array.from(new Set((memberships ?? []).map(m => m.user_id as string)))
    if (adminUserIds.length === 0) {
      return NextResponse.json({ tenants_scanned: digests.length, emails_sent: 0, message: 'No tenant admins found.' })
    }

    const { data: profiles } = await admin
      .from('profiles').select('id, email, full_name').in('id', adminUserIds)
    const profileById = new Map<string, { email: string | null; full_name: string | null }>()
    for (const p of profiles ?? []) profileById.set(p.id as string, { email: p.email as string | null, full_name: p.full_name as string | null })

    const { data: tenants } = await admin.from('tenants').select('id, name').in('id', tenantIds)
    const tenantNameById = new Map<string, string>()
    for (const t of tenants ?? []) tenantNameById.set(t.id as string, t.name as string)

    const recipients: { email: string; full_name: string | null; tenant_id: string }[] = []
    for (const m of memberships ?? []) {
      const prof = profileById.get(m.user_id as string)
      if (!prof?.email) continue
      recipients.push({ email: prof.email, full_name: prof.full_name, tenant_id: m.tenant_id as string })
    }

    const vehiclesUrl = `${appUrl}/fleet/vehicles`
    const driversUrl  = `${appUrl}/fleet/drivers`
    const suppressed  = await loadSuppressedEmails(admin, 'reminders')
    const sendable    = recipients.filter(r => !suppressed.has(r.email.toLowerCase()))

    const results = await Promise.allSettled(
      sendable.map(r => {
        const digest = digests.find(d => d.tenant_id === r.tenant_id)
        if (!digest) return Promise.resolve({ sent: false, providerId: null })
        return sendFleetExpiryReminder({
          to:             r.email,
          reviewerName:   r.full_name ?? '',
          tenantName:     tenantNameById.get(r.tenant_id) ?? 'your tenant',
          rows:           digest.rows,
          vehiclesUrl,
          driversUrl,
          unsubscribeUrl: buildUnsubscribe(appUrl, r.email, 'reminders')?.url ?? null,
        })
      }),
    )
    const sent = results.filter(r => r.status === 'fulfilled' && r.value.sent).length

    return NextResponse.json({
      tenants_scanned: digests.length,
      recipients:      sendable.length,
      emails_sent:     sent,
      emails_failed:   results.length - sent,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/fleet-document-expiry-reminders' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
