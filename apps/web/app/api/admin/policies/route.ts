import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ingestPolicyDocument, isWithinTenantStaging } from '@/lib/ai/ingestPolicy'

// Tenant self-service knowledge base — a tenant's own company policies that
// the home-page assistant retrieves and cites. Mirrors /superadmin/policies
// but auto-scoped to the caller's tenant: source_type is always
// 'company_policy' and tenant_id is taken from the auth gate, never the body.
//
//   GET  /api/admin/policies        — list this tenant's documents (any member)
//   POST /api/admin/policies        — ingest a staged file (admin/owner only)
//   DELETE /api/admin/policies/:id  — see ./[id]/route.ts

export const runtime     = 'nodejs'
export const maxDuration = 300

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await supabaseAdmin()
    .from('knowledge_documents')
    .select('id, source_type, title, jurisdiction, effective_date, source_url, chunk_count, created_at')
    .eq('tenant_id', gate.tenantId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) {
    Sentry.captureException(error, { tags: { source: '/api/admin/policies GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ documents: data ?? [] })
}

interface IngestBody {
  storage_path?:   string
  title?:          string
  jurisdiction?:   string
  effective_date?: string
  source_url?:     string
  mime?:           string
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: IngestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected application/json body.' }, { status: 400 }) }

  // Load-bearing: the staged object must live under THIS tenant's prefix.
  // Without this a tenant admin could point the ingester at another tenant's
  // staged file (the server reads as service-role, bypassing storage RLS).
  const storagePath = (body.storage_path ?? '').trim()
  if (!isWithinTenantStaging(storagePath, gate.tenantId)) {
    return NextResponse.json(
      { error: 'Invalid storage_path. Use the upload URL issued for your organization.' },
      { status: 400 },
    )
  }

  const title = (body.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })

  const out = await ingestPolicyDocument({
    storagePath,
    tenantId:      gate.tenantId,    // forced — never from the client
    sourceType:    'company_policy', // tenants can only add their own policies
    title,
    jurisdiction:  body.jurisdiction,
    effectiveDate: body.effective_date,
    sourceUrl:     body.source_url,
    mime:          body.mime,
    userId:        gate.userId,
    route:         '/api/admin/policies',
  })
  return NextResponse.json(out.body, { status: out.status })
}
