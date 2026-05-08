import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// DELETE /api/superadmin/policies/[id]
//
// Deletes the document; the cascade on knowledge_chunks.document_id
// drops every embedded chunk along with it.

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid document id.' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { error } = await admin.from('knowledge_documents').delete().eq('id', id)
  if (error) {
    Sentry.captureException(error, { tags: { source: '/api/superadmin/policies DELETE', document_id: id } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
