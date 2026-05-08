import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET  /api/superadmin/policies            — list all knowledge documents
// GET  /api/superadmin/policies?tenant=…   — filter to one tenant (or 'global')
// DELETE /api/superadmin/policies/:id      — see ./[id]/route.ts (delete cascades to chunks)

const MAX_ROWS = 500

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const tenantParam = url.searchParams.get('tenant')

  const admin = supabaseAdmin()
  let q = admin
    .from('knowledge_documents')
    .select('id, tenant_id, source_type, title, jurisdiction, effective_date, source_url, chunk_count, created_at')
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  if (tenantParam === 'global') q = q.is('tenant_id', null)
  else if (tenantParam && /^[0-9a-f-]{36}$/i.test(tenantParam)) q = q.eq('tenant_id', tenantParam)

  const { data, error } = await q
  if (error) {
    Sentry.captureException(error, { tags: { source: '/api/superadmin/policies GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Best-effort tenant name lookup so the UI doesn't have to do a
  // second query just to render a label.
  const tenantIds = [...new Set((data ?? [])
    .map(d => (d as { tenant_id: string | null }).tenant_id)
    .filter((t): t is string => !!t))]
  const tenantNames: Record<string, string> = {}
  if (tenantIds.length > 0) {
    const { data: tRows } = await admin.from('tenants').select('id, name').in('id', tenantIds)
    for (const t of tRows ?? []) tenantNames[(t as { id: string }).id] = (t as { name: string }).name
  }

  return NextResponse.json({
    documents: (data ?? []).map(d => ({
      ...d,
      tenant_name: (d as { tenant_id: string | null }).tenant_id
        ? (tenantNames[(d as { tenant_id: string }).tenant_id] ?? null)
        : null,
    })),
  })
}
