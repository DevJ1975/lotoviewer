import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { SUPPORTED_MIMES, type ExtractMime } from '@/lib/ai/policyExtract'
import { tenantStagingPrefix } from '@/lib/ai/ingestPolicy'

// POST /api/admin/policies/upload-url
//
// Issues a one-shot signed upload URL into the (superadmin-RLS-locked)
// policy-uploads bucket so a tenant admin's browser can stage a file WITHOUT
// the bucket granting tenants direct write access. The signed token is minted
// by the service role for a path under this tenant's prefix only; the ingest
// route then re-validates that prefix before reading the object. This keeps
// all tenant scoping in application code we control + test.
//
// Body: { mime: string }
// Returns: { path, token } → browser calls supabase.storage
//   .from('policy-uploads').uploadToSignedUrl(path, token, file).

export const runtime = 'nodejs'

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf':   'pdf',
  'text/markdown':     'md',
  'text/x-markdown':   'md',
  'text/plain':        'txt',
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { mime?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected application/json body.' }, { status: 400 }) }

  const mime = String(body.mime ?? '').trim() as ExtractMime
  if (!mime || !SUPPORTED_MIMES.includes(mime)) {
    return NextResponse.json(
      { error: `Unsupported file type. Supported: ${SUPPORTED_MIMES.join(', ')}.` },
      { status: 415 },
    )
  }

  const ext  = EXT_BY_MIME[mime] ?? 'bin'
  const path = `${tenantStagingPrefix(gate.tenantId)}${crypto.randomUUID()}.${ext}`

  const { data, error } = await supabaseAdmin()
    .storage.from('policy-uploads')
    .createSignedUploadUrl(path)
  if (error || !data) {
    return NextResponse.json(
      { error: `Could not create an upload URL: ${error?.message ?? 'unknown error'}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ path: data.path, token: data.token })
}
