import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/email-log?days=7&kind=invite&status=failed
//
// Recent email_log rows with optional filters.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_DAYS = 7
const MAX_DAYS     = 90
const MAX_LIMIT    = 1000

export interface EmailLogRow {
  id:           number
  kind:         string
  to_email:     string
  subject:      string | null
  tenant_id:    string | null
  tenant_name:  string | null
  provider_id:  string | null
  status:       'sent' | 'failed' | 'skipped'
  error_text:   string | null
  triggered_by: string | null
  occurred_at:  string
}

export interface EmailLogResponse {
  windowDays: number
  rows:       EmailLogRow[]
  counts:     { sent: number; failed: number; skipped: number }
}

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const daysRaw = Number(url.searchParams.get('days') ?? DEFAULT_DAYS)
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.floor(daysRaw), MAX_DAYS) : DEFAULT_DAYS
  const kind   = url.searchParams.get('kind')   || null
  const status = url.searchParams.get('status') || null
  const since  = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const admin = supabaseAdmin()
  let q = admin
    .from('email_log')
    .select('id, kind, to_email, subject, tenant_id, provider_id, status, error_text, triggered_by, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(MAX_LIMIT)
  if (kind) q = q.eq('kind', kind)
  if (status === 'sent' || status === 'failed' || status === 'skipped') q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as Array<Omit<EmailLogRow, 'tenant_name'>>

  const tenantIds = Array.from(new Set(rows.map(r => r.tenant_id).filter((x): x is string => !!x)))
  const tenantNameById = new Map<string, string>()
  if (tenantIds.length > 0) {
    const { data: tenants } = await admin.from('tenants').select('id, name').in('id', tenantIds)
    for (const t of (tenants ?? []) as Array<{ id: string; name: string }>) {
      tenantNameById.set(t.id, t.name)
    }
  }

  const enriched: EmailLogRow[] = rows.map(r => ({
    ...r,
    tenant_name: r.tenant_id ? tenantNameById.get(r.tenant_id) ?? null : null,
  }))

  const counts = { sent: 0, failed: 0, skipped: 0 }
  for (const r of enriched) counts[r.status] += 1

  return NextResponse.json({ windowDays: days, rows: enriched, counts } as EmailLogResponse)
}
