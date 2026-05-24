import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetAdmin } from '@/lib/fleet/gate'

// DELETE /api/fleet/documents/:docId   Remove a scanned-document record (admin).
//
// The storage object in `fleet-docs` is removed best-effort by the client
// after this succeeds; an orphaned object is harmless and tenant-scoped.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function DELETE(req: Request, ctx: { params: Promise<{ docId: string }> }) {
  const { docId } = await ctx.params
  if (!UUID_RE.test(docId)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('fleet_vehicle_documents')
    .delete()
    .eq('id', docId)
    .eq('tenant_id', gate.tenantId)
    .select('file_path')
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/documents/[docId]/DELETE' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true, file_path: data?.file_path ?? null })
}
