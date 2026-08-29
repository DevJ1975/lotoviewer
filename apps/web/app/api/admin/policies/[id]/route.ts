import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// DELETE /api/admin/policies/[id]
//
// Removes one of THIS tenant's company-policy documents; the cascade on
// knowledge_chunks.document_id drops its embedded chunks. The delete is
// scoped with `.eq('tenant_id', …)` so a tenant admin can never delete
// another tenant's (or a global) document, even though the service-role
// client bypasses RLS.

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid document id.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin()
    .from('knowledge_documents')
    .delete()
    .eq('id', id)
    .eq('tenant_id', gate.tenantId)
    .select('id')
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { source: '/api/admin/policies DELETE', document_id: id } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
