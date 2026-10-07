import { NextResponse } from 'next/server'
import { requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { ENVIRONMENTAL_MODULE, findDocument, type DocumentRow } from '@/lib/environmental/documentApi'

// GET /api/environmental/documents/[id]
// One document including the service's proposal (fields, each with the text it
// came from) and, once decided, what the reviewer confirmed.

export const runtime = 'nodejs'

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const g = await requireTenantModuleMember(req, ENVIRONMENTAL_MODULE)
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })

  const { id } = await ctx.params
  const found = await findDocument(g, id, 'environmental/documents/[id]/GET')
  if ('response' in found) return found.response

  // storage_path is an internal key; the file is reached through ./url.
  const document: Partial<DocumentRow> = { ...found.document }
  delete document.storage_path
  return NextResponse.json({ document })
}
