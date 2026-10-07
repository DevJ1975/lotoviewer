import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { ENVIRONMENTAL_DOCS_BUCKET } from '@soteria/core/documentExtraction'
import { ENVIRONMENTAL_MODULE, findDocument } from '@/lib/environmental/documentApi'

// GET /api/environmental/documents/[id]/url
// A short-lived signed URL for the original PDF, so a reviewer can check each
// proposed value against its source. The bucket is private; access is decided
// by findDocument (the caller's RLS-scoped view) before anything is signed.

export const runtime = 'nodejs'

const TTL_SECONDS = 60 * 5

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })

  const { id } = await ctx.params
  const found = await findDocument(g, id, 'environmental/documents/[id]/url')
  if ('response' in found) return found.response

  const { data, error } = await supabaseAdmin()
    .storage.from(ENVIRONMENTAL_DOCS_BUCKET).createSignedUrl(found.document.storage_path, TTL_SECONDS)
  if (error || !data?.signedUrl) return sanitizeError(error ?? new Error('no signed URL'), 'environmental/documents/[id]/url')
  return NextResponse.json({ url: data.signedUrl, expires_in: TTL_SECONDS })
}
