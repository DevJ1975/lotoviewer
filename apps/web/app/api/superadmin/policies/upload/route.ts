import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { ingestPolicyDocument } from '@/lib/ai/ingestPolicy'

// POST /api/superadmin/policies/upload
//
// Body (application/json):
//   storage_path:   path inside the policy-uploads Supabase Storage bucket
//                   where the browser put the file. The route downloads the
//                   bytes server-side and processes them. We use storage
//                   staging because Vercel caps direct request bodies at
//                   4.5MB, smaller than the 25MB limit the route + bucket
//                   support.
//   tenant_id:      (optional) UUID. NULL/missing → global document visible
//                   to all tenants.
//   source_type:    one of regulation/state_reg/dot/epa/rcra/company_policy.
//   title:          short title (≤300 chars).
//   jurisdiction:   (optional) e.g. "CA" for state_reg.
//   effective_date: (optional) ISO date.
//   source_url:     (optional) canonical source link.
//   mime:           (optional) MIME hint.
//
// The download → extract → chunk → embed → insert → cleanup pipeline lives in
// lib/ai/ingestPolicy.ts and is shared with the tenant self-service route.
// Idempotent on (tenant_id, sha256).

const VALID_SOURCE_TYPES = new Set([
  'regulation', 'state_reg', 'dot', 'epa', 'rcra', 'company_policy',
])

export const runtime     = 'nodejs'
export const maxDuration = 300

interface RequestBody {
  storage_path?:   string
  tenant_id?:      string | null
  source_type?:    string
  title?:          string
  jurisdiction?:   string
  effective_date?: string
  source_url?:     string
  mime?:           string
}

export async function POST(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: RequestBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected application/json body.' }, { status: 400 }) }

  const storagePath = (body.storage_path ?? '').trim()
  if (!storagePath) {
    return NextResponse.json(
      { error: 'storage_path is required. Upload the file to the policy-uploads bucket first.' },
      { status: 400 },
    )
  }

  const sourceType = String(body.source_type ?? 'company_policy')
  if (!VALID_SOURCE_TYPES.has(sourceType)) {
    return NextResponse.json({ error: `Invalid source_type: ${sourceType}.` }, { status: 400 })
  }

  const title = (body.title ?? '').trim()
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })

  const tenantId = typeof body.tenant_id === 'string' && /^[0-9a-f-]{36}$/i.test(body.tenant_id.trim())
    ? body.tenant_id.trim()
    : null
  if (sourceType === 'company_policy' && !tenantId) {
    return NextResponse.json(
      { error: 'tenant_id is required for company_policy uploads.' },
      { status: 400 },
    )
  }

  const out = await ingestPolicyDocument({
    storagePath,
    tenantId,
    sourceType,
    title,
    jurisdiction:  body.jurisdiction,
    effectiveDate: body.effective_date,
    sourceUrl:     body.source_url,
    mime:          body.mime,
    userId:        gate.userId,
    route:         '/api/superadmin/policies/upload',
  })
  return NextResponse.json(out.body, { status: out.status })
}
