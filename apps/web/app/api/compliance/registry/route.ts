import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { ZodError } from 'zod'
import { requireTenantModuleMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { legalRegisterCreateSchema } from '@/lib/compliance/validators'
import { LEGAL_STATUSES } from '@soteria/core/compliance'

// GET  /api/compliance/registry  — list legal-registry entries for tenant
// POST /api/compliance/registry  — create a new entry
//
// Both endpoints are tenant-module gated; the module id `compliance`
// is checked against the tenant's `modules` map so a tenant that
// has the module disabled gets a clean 403 even if RLS would still
// allow the read.

const MAX_LIMIT = 200

export async function GET(req: Request) {
  const gate = await requireTenantModuleMember(req, 'compliance')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const search       = url.searchParams.get('q')?.trim()           ?? ''
  const statusParam  = url.searchParams.get('status')?.trim()      ?? ''
  const jurisdiction = url.searchParams.get('jurisdiction')?.trim() ?? ''
  const limit        = clamp(parseInt(url.searchParams.get('limit') ?? '50', 10), 1, MAX_LIMIT, 50)
  const offset       = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  let q = gate.authedClient
    .from('legal_register')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (search) {
    // citation OR title contains. Postgres `ilike` via Supabase `or`.
    const escaped = search.replace(/[%,]/g, m => '\\' + m)
    q = q.or(`citation.ilike.%${escaped}%,title.ilike.%${escaped}%`)
  }
  if (statusParam && (LEGAL_STATUSES as readonly string[]).includes(statusParam)) {
    q = q.eq('status', statusParam)
  }
  if (jurisdiction) q = q.eq('jurisdiction', jurisdiction)

  const { data, error, count } = await q
  if (error) {
    Sentry.captureException(error, { tags: { route: 'compliance/registry/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({
    entries: data ?? [],
    total:   count ?? 0,
    limit,
    offset,
  })
}

export async function POST(req: Request) {
  // Authoring legal-register rows is admin-only — the registry feeds
  // compliance posture, so it sits above member-write authority.
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  let payload
  try {
    payload = legalRegisterCreateSchema.parse(body)
  } catch (e) {
    if (e instanceof ZodError) {
      return NextResponse.json({ error: 'Validation failed', issues: e.issues }, { status: 400 })
    }
    throw e
  }

  const { data, error } = await gate.authedClient
    .from('legal_register')
    .insert({
      tenant_id:           gate.tenantId,
      citation:            payload.citation,
      title:               payload.title,
      jurisdiction:        payload.jurisdiction,
      authority:           payload.authority         ?? null,
      source_url:          payload.source_url        ?? null,
      summary:             payload.summary           ?? null,
      applicability_note:  payload.applicability_note ?? null,
      status:              payload.status            ?? 'active',
      effective_date:      payload.effective_date    ?? null,
      last_reviewed_at:    payload.last_reviewed_at  ?? null,
      next_review_due:     payload.next_review_due   ?? null,
      review_frequency:    payload.review_frequency  ?? null,
      tags:                payload.tags              ?? [],
      created_by:          gate.userId,
    })
    .select('*')
    .single()

  if (error) {
    // 23505 = unique_violation (citation already exists for this tenant)
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Citation already exists for this tenant' }, { status: 409 })
    }
    Sentry.captureException(error, { tags: { route: 'compliance/registry/POST' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ entry: data }, { status: 201 })
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
