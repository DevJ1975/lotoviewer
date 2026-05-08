import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendChemicalsDigest } from '@/lib/email/sendChemicalsDigest'
import {
  isDigestEmpty,
  type ChemicalsDigest,
  type DigestSdsRow,
  type DigestApprovalRow,
  type DigestDriftRow,
  type DigestExpiringRow,
} from '@soteria/core/chemicals'

// Weekly chemicals digest cron — Mondays 07:00 UTC.
//
// For each tenant with at least one actionable chemical event,
// emails every owner/admin a roll-up of:
//   - Pending SDS reviews (parse_review_status='pending')
//   - Pending container approvals (status='requested')
//   - Drift events from the last 7 days (newer/older/fetch_failed)
//   - Containers expiring within 30 days
//
// Tenants with nothing actionable get nothing — quieter is friendlier.
//
// Auth: same posture as the other crons (Bearer CRON_SECRET or
// x-internal-secret).

export const runtime = 'nodejs'

const DRIFT_WINDOW_DAYS    = 7
const EXPIRING_WINDOW_DAYS = 30

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
  if (env) return env.replace(/\/+$/, '')
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
  const admin  = supabaseAdmin()
  const appUrl = publicAppUrl(req)

  const driftCutoff    = new Date(Date.now() - DRIFT_WINDOW_DAYS    * 86_400_000).toISOString()
  const expiringCutoff = new Date(Date.now() + EXPIRING_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10)
  const now            = Date.now()

  try {
    // 1. Pull every actionable row across all tenants in one shot per source.
    //    We sort/group in JS rather than per-tenant round-trips.

    const [pendingSds, pendingApprovals, driftEvents, expiring] = await Promise.all([
      admin.from('chemical_sds_documents')
        .select(`
          id, tenant_id, product_id, revision_date, created_at,
          chemical_products!product_id ( id, name, manufacturer, archived_at )
        `)
        .eq('parse_review_status', 'pending')
        .limit(2000),
      admin.from('chemical_inventory_items')
        .select(`
          id, tenant_id, barcode, requested_by, requested_at, created_at,
          chemical_products ( id, name, archived_at )
        `)
        .eq('status', 'requested')
        .limit(2000),
      admin.from('chemical_sds_revision_checks')
        .select(`
          id, tenant_id, product_id, outcome, checked_at, notes,
          chemical_products ( id, name, archived_at )
        `)
        .gte('checked_at', driftCutoff)
        .in('outcome', ['newer', 'older', 'fetch_failed'])
        .limit(2000),
      admin.from('v_chemical_expiring_soon')
        .select('id, tenant_id, product_name, barcode, location_path, expiration_date, days_remaining')
        .lte('expiration_date', expiringCutoff)
        .limit(2000),
    ])

    if (pendingSds.error)       throw new Error(pendingSds.error.message)
    if (pendingApprovals.error) throw new Error(pendingApprovals.error.message)
    if (driftEvents.error)      throw new Error(driftEvents.error.message)
    if (expiring.error)         throw new Error(expiring.error.message)

    // Resolve requester display names in one batch.
    const requesterIds = Array.from(new Set(
      (pendingApprovals.data ?? [])
        .map(r => r.requested_by)
        .filter((u): u is string => !!u),
    ))
    let requesterNames: Record<string, string> = {}
    if (requesterIds.length > 0) {
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, full_name')
        .in('id', requesterIds)
      requesterNames = Object.fromEntries(
        (profiles ?? []).map(p => [p.id, p.full_name ?? '']),
      )
    }

    // 2. Bucket by tenant.
    const digests = new Map<string, ChemicalsDigest>()
    const ensure = (tenantId: string): ChemicalsDigest => {
      let d = digests.get(tenantId)
      if (!d) {
        d = {
          tenant_id:         tenantId,
          tenant_name:       'Tenant',  // backfilled in step 3
          pending_sds:       [],
          pending_approvals: [],
          drift_events:      [],
          expiring_soon:     [],
        }
        digests.set(tenantId, d)
      }
      return d
    }

    function pickProduct(j: unknown): { id?: string; name?: string; manufacturer?: string | null; archived_at?: string | null } | null {
      const join = j as { id?: string; name?: string; manufacturer?: string | null; archived_at?: string | null } | { id?: string; name?: string; manufacturer?: string | null; archived_at?: string | null }[] | null
      if (!join) return null
      return Array.isArray(join) ? (join[0] ?? null) : join
    }

    for (const r of pendingSds.data ?? []) {
      const p = pickProduct(r.chemical_products)
      if (!p?.id || p.archived_at) continue
      const row: DigestSdsRow = {
        product_id:    p.id,
        product_name:  p.name ?? 'Chemical',
        manufacturer:  p.manufacturer ?? null,
        revision_date: r.revision_date ?? null,
        parsed_at:     r.created_at,
      }
      ensure(r.tenant_id).pending_sds.push(row)
    }

    for (const r of pendingApprovals.data ?? []) {
      const p = pickProduct(r.chemical_products)
      if (!p?.id || p.archived_at) continue
      const requestedAt = r.requested_at ?? r.created_at
      const ageDays = Math.floor((now - Date.parse(requestedAt)) / 86_400_000)
      const row: DigestApprovalRow = {
        inventory_id:   r.id,
        product_name:   p.name ?? 'Chemical',
        barcode:        r.barcode,
        requester_name: r.requested_by ? requesterNames[r.requested_by] ?? null : null,
        requested_at:   requestedAt,
        age_days:       Math.max(0, ageDays),
      }
      ensure(r.tenant_id).pending_approvals.push(row)
    }

    for (const r of driftEvents.data ?? []) {
      const p = pickProduct(r.chemical_products)
      if (!p?.id || p.archived_at) continue
      const row: DigestDriftRow = {
        product_id:    p.id,
        product_name:  p.name ?? 'Chemical',
        outcome:       r.outcome as 'newer' | 'older' | 'fetch_failed',
        checked_at:    r.checked_at,
        notes:         r.notes ?? null,
      }
      ensure(r.tenant_id).drift_events.push(row)
    }

    for (const r of expiring.data ?? []) {
      const row: DigestExpiringRow = {
        product_name:    r.product_name,
        barcode:         r.barcode,
        location_path:   r.location_path,
        expiration_date: r.expiration_date,
        days_remaining:  r.days_remaining,
      }
      ensure(r.tenant_id).expiring_soon.push(row)
    }

    // 3. Backfill tenant names.
    const tenantIds = Array.from(digests.keys())
    if (tenantIds.length === 0) {
      return NextResponse.json({ tenants_scanned: 0, emails_sent: 0, message: 'No actionable rows.' })
    }
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, name')
      .in('id', tenantIds)
    for (const t of tenants ?? []) {
      const d = digests.get(t.id)
      if (d) d.tenant_name = t.name
    }

    // 4. Resolve admin recipients per tenant (owner / admin role).
    const { data: memberships, error: mErr } = await admin
      .from('tenant_memberships')
      .select('user_id, tenant_id, role')
      .in('tenant_id', tenantIds)
      .in('role', ['owner', 'admin'])
    if (mErr) throw new Error(mErr.message)

    const adminUserIds = Array.from(new Set((memberships ?? []).map(m => m.user_id)))
    if (adminUserIds.length === 0) {
      return NextResponse.json({ tenants_scanned: digests.size, emails_sent: 0, message: 'No tenant admins.' })
    }

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, full_name')
      .in('id', adminUserIds)
    const profileById = new Map((profiles ?? []).map(p => [p.id, p] as const))

    // Email addresses live on auth.users; supabase-js exposes them
    // via auth.admin.getUserById. One round-trip per admin is fine
    // at the scale this cron runs (handful per tenant, weekly).
    const emailById = new Map<string, string>()
    for (const uid of adminUserIds) {
      try {
        const { data, error } = await admin.auth.admin.getUserById(uid)
        if (!error && data.user?.email) emailById.set(uid, data.user.email)
      } catch (e) {
        Sentry.captureException(e, { tags: { route: 'chemicals-weekly-digest', stage: 'email-lookup' } })
      }
    }

    // 5. Send.
    let sent = 0, failed = 0, skippedEmpty = 0
    for (const [tenantId, digest] of digests) {
      if (isDigestEmpty(digest)) { skippedEmpty += 1; continue }

      const recipientIds = (memberships ?? [])
        .filter(m => m.tenant_id === tenantId)
        .map(m => m.user_id)

      for (const uid of recipientIds) {
        const email = emailById.get(uid)
        if (!email) continue
        const profile = profileById.get(uid)
        const result = await sendChemicalsDigest({
          to:           email,
          reviewerName: profile?.full_name ?? '',
          digest,
          reviewUrl:    `${appUrl}/chemicals/review`,
          approvalsUrl: `${appUrl}/chemicals/approvals`,
          driftUrl:     `${appUrl}/chemicals/drift`,
          expiringUrl:  `${appUrl}/chemicals/inventory?expiring=true`,
        })
        if (result.sent) sent += 1
        else failed += 1
      }
    }

    return NextResponse.json({
      tenants_scanned: digests.size,
      emails_sent:     sent,
      emails_failed:   failed,
      tenants_skipped_empty: skippedEmpty,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'chemicals-weekly-digest' } })
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 })
  }
}
