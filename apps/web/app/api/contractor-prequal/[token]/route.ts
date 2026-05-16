import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Public, tokenized contractor-prequal portal API. No auth — the URL
// token is the auth. Service role under the hood. Mirrors the
// loto_review_links pattern in apps/web/app/api/review/[token]/.

const TOKEN_RE = /^[0-9a-f]{32}$/

interface RouteCtx { params: Promise<{ token: string }> }

type LookupOk = {
  ok: true
  prequal: {
    id:                     string
    tenant_id:              string
    contractor_company_id:  string
    status:                 string
    q1_safety_management:   string | null
    q2_emr:                 string | null
    q3_dart:                string | null
    q4_trir:                string | null
    q5_iso_certs:           string | null
    q6_drug_alcohol_program: boolean
    q7_insurance_limits:    string | null
    q8_references:          string | null
    submitted_at:           string | null
    review_notes:           string | null
  }
  contractorName: string | null
}

async function lookup(token: string): Promise<LookupOk | { ok: false; status: number; message: string }> {
  if (!TOKEN_RE.test(token)) {
    return { ok: false, status: 400, message: 'Invalid token format' }
  }
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('vendor_prequalifications')
    .select(`
      id, tenant_id, contractor_company_id, status,
      q1_safety_management, q2_emr, q3_dart, q4_trir, q5_iso_certs,
      q6_drug_alcohol_program, q7_insurance_limits, q8_references,
      submitted_at, review_notes,
      contractor:loto_contractor_companies (name)
    `)
    .eq('portal_token', token)
    .maybeSingle<{
      id: string; tenant_id: string; contractor_company_id: string; status: string
      q1_safety_management: string | null; q2_emr: string | null; q3_dart: string | null
      q4_trir: string | null; q5_iso_certs: string | null
      q6_drug_alcohol_program: boolean; q7_insurance_limits: string | null
      q8_references: string | null; submitted_at: string | null; review_notes: string | null
      contractor: { name: string } | null
    }>()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'contractor-prequal/[token]', stage: 'lookup' } })
    return { ok: false, status: 500, message: error.message }
  }
  if (!data) return { ok: false, status: 404, message: 'Prequalification not found' }
  if (data.status === 'expired' || data.status === 'rejected') {
    return { ok: false, status: 410, message: 'This prequalification link is no longer active.' }
  }
  // Submitted prequals still let the contractor view their answers
  // but POST is rejected below — read remains permitted.
  const { contractor, ...rest } = data
  return { ok: true, prequal: rest, contractorName: contractor?.name ?? null }
}

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const { token } = await ctx.params
  const res = await lookup(token)
  if (!res.ok) return NextResponse.json({ error: res.message }, { status: res.status })
  return NextResponse.json({ prequal: res.prequal, contractorName: res.contractorName })
}

interface PostBody {
  q1_safety_management?:   unknown
  q2_emr?:                 unknown
  q3_dart?:                unknown
  q4_trir?:                unknown
  q5_iso_certs?:           unknown
  q6_drug_alcohol_program?: unknown
  q7_insurance_limits?:    unknown
  q8_references?:          unknown
}

function asText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, 4000)
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { token } = await ctx.params
  const found = await lookup(token)
  if (!found.ok) return NextResponse.json({ error: found.message }, { status: found.status })

  if (found.prequal.submitted_at) {
    return NextResponse.json({ error: 'Already submitted — contact the host for changes.' }, { status: 409 })
  }

  let body: PostBody
  try { body = await req.json() as PostBody } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('vendor_prequalifications')
    .update({
      q1_safety_management:    asText(body.q1_safety_management),
      q2_emr:                  asText(body.q2_emr),
      q3_dart:                 asText(body.q3_dart),
      q4_trir:                 asText(body.q4_trir),
      q5_iso_certs:            asText(body.q5_iso_certs),
      q6_drug_alcohol_program: Boolean(body.q6_drug_alcohol_program),
      q7_insurance_limits:     asText(body.q7_insurance_limits),
      q8_references:           asText(body.q8_references),
      status:                  'in_progress',
    })
    .eq('id', found.prequal.id)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'contractor-prequal/[token]', stage: 'save' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

// Final submit — flips status to ready-for-review and stamps the
// submitted_at column. Idempotent: re-submitting returns 409.
export async function PATCH(_req: NextRequest, ctx: RouteCtx) {
  const { token } = await ctx.params
  const found = await lookup(token)
  if (!found.ok) return NextResponse.json({ error: found.message }, { status: found.status })

  if (found.prequal.submitted_at) {
    return NextResponse.json({ error: 'Already submitted.' }, { status: 409 })
  }

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('vendor_prequalifications')
    .update({
      submitted_at: new Date().toISOString(),
      status:       'in_progress',
    })
    .eq('id', found.prequal.id)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'contractor-prequal/[token]', stage: 'submit' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
