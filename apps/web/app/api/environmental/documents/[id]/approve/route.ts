import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { parseProposal, planObligations, reviewAcceptedFields } from '@soteria/core/documentExtraction'
import {
  ENVIRONMENTAL_MODULE, bestEffort, findDocument, forbidNonReviewer,
} from '@/lib/environmental/documentApi'

// POST /api/environmental/documents/[id]/approve
//
// A tenant admin confirms (and may correct) the fields the service proposed.
// Body: { accepted: [{ index, value }], create_obligations?: boolean }
//   index → position in the proposal's fields; the server takes the key and
//           label from the proposal, so a client can confirm or correct what
//           the service found but cannot invent a field.
//   create_obligations (default true) → a confirmed expiration / renewal date
//           becomes a one-time compliance-calendar entry that names its source.

export const runtime = 'nodejs'

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })
  const denied = forbidNonReviewer(g)
  if (denied) return denied

  const { id } = await ctx.params
  const found = await findDocument(g, id, 'environmental/documents/[id]/approve')
  if ('response' in found) return found.response
  const { document } = found

  if (document.status !== 'needs_review') {
    return NextResponse.json({ error: `This document is ${document.status.replace('_', ' ')}, so it cannot be approved.` }, { status: 409 })
  }
  const proposal = parseProposal(document)
  if (!proposal) return NextResponse.json({ error: 'This document has no readable proposal.' }, { status: 422 })

  let body: { accepted?: unknown; create_obligations?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 }) }

  const review = reviewAcceptedFields(proposal, body.accepted)
  if (!review.ok) return NextResponse.json({ error: review.error }, { status: 400 })

  const admin = supabaseAdmin()

  // Claim the document first. The status guard makes this atomic, so a double
  // click or two admins can never both go on to create calendar entries.
  const { data: claimed, error: claimErr } = await admin
    .from('document_extractions')
    .update({
      status: 'approved', reviewed_by: g.userId, reviewed_at: new Date().toISOString(),
      reviewed_fields: review.fields,
    })
    .eq('id', document.id).eq('tenant_id', g.tenantId).eq('status', 'needs_review')
    .select('id')
  if (claimErr) return sanitizeError(claimErr, 'environmental/documents/[id]/approve')
  if (!claimed?.length) {
    return NextResponse.json({ error: 'This document was just decided by someone else.' }, { status: 409 })
  }

  const drafts = body.create_obligations === false
    ? []
    : planObligations(review.fields, { documentId: document.id, docType: proposal.docType, fileName: document.file_name })

  let obligationIds: string[] = []
  if (drafts.length > 0) {
    // Through the caller's own client, so calendar RLS applies to what we add.
    const { data: created, error: createErr } = await g.authedClient
      .from('compliance_calendar_obligations')
      .insert(drafts.map(d => ({ ...d, tenant_id: g.tenantId, source: 'tenant', created_by: g.userId })))
      .select('id')
    if (createErr) {
      // Put the document back in the queue rather than leave it "approved"
      // with nothing on the calendar.
      await bestEffort('revert-claim', admin
        .from('document_extractions')
        .update({ status: 'needs_review', reviewed_by: null, reviewed_at: null, reviewed_fields: [] })
        .eq('id', document.id).eq('tenant_id', g.tenantId).eq('status', 'approved'))
      return sanitizeError(createErr, 'environmental/documents/[id]/approve')
    }
    obligationIds = (created ?? []).map(r => (r as { id: string }).id)

    await bestEffort('link-obligations', admin
      .from('document_extractions').update({ obligation_ids: obligationIds })
      .eq('id', document.id).eq('tenant_id', g.tenantId))
  }

  return NextResponse.json({ ok: true, fields: review.fields, obligation_ids: obligationIds })
}
