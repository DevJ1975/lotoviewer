import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { ENVIRONMENTAL_MODULE, findDocument, forbidNonReviewer } from '@/lib/environmental/documentApi'

// POST /api/environmental/documents/[id]/reject
// A tenant admin discards a proposal (wrong document, bad scan) or dismisses a
// document that could not be read. Nothing was filed, so there is nothing to undo.

export const runtime = 'nodejs'

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })
  const denied = forbidNonReviewer(g)
  if (denied) return denied

  const { id } = await ctx.params
  const found = await findDocument(g, id, 'environmental/documents/[id]/reject')
  if ('response' in found) return found.response

  const { data, error } = await supabaseAdmin()
    .from('document_extractions')
    .update({ status: 'rejected', reviewed_by: g.userId, reviewed_at: new Date().toISOString() })
    .eq('id', found.document.id).eq('tenant_id', g.tenantId).in('status', ['needs_review', 'failed'])
    .select('id')
  if (error) return sanitizeError(error, 'environmental/documents/[id]/reject')
  if (!data?.length) {
    return NextResponse.json({ error: 'This document has already been decided.' }, { status: 409 })
  }
  return NextResponse.json({ ok: true })
}
