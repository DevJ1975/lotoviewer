import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireFleetMember, requireFleetAdmin } from '@/lib/fleet/gate'
import { validateDocumentInput, type DocumentRow } from '@soteria/core/fleet'

// GET  /api/fleet/vehicles/:id/documents   List scanned documents (member).
// POST /api/fleet/vehicles/:id/documents   Record a document (admin).
//
// The file itself uploads straight to the private `fleet-docs` bucket from
// the browser (RLS-scoped); this endpoint records the metadata + object key.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { data, error } = await gate.authedClient
    .from('fleet_vehicle_documents')
    .select('*')
    .eq('vehicle_id', id)
    .order('doc_type')
    .order('expires_at', { ascending: true, nullsFirst: false })
  if (error) {
    Sentry.captureException(error, { tags: { route: 'fleet/documents/GET' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ documents: data ?? [] })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Bad id' }, { status: 400 })

  const gate = await requireFleetAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Partial<DocumentRow>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const problem = validateDocumentInput(body)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const db = gate.authedClient
  const { data: vehicle } = await db
    .from('fleet_vehicles').select('id').eq('id', id).eq('tenant_id', gate.tenantId).maybeSingle()
  if (!vehicle) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const insert = {
    tenant_id:  gate.tenantId,
    vehicle_id: id,
    doc_type:   body.doc_type,
    reference:  trimOrNull(body.reference),
    issued_at:  body.issued_at || null,
    expires_at: body.expires_at || null,
    file_path:  trimOrNull(body.file_path),
    file_name:  trimOrNull(body.file_name),
    mime_type:  trimOrNull(body.mime_type),
    notes:      trimOrNull(body.notes),
    created_by: gate.userId,
  }
  const { data, error } = await db
    .from('fleet_vehicle_documents')
    .insert(insert)
    .select('*')
    .single()
  if (error || !data) {
    Sentry.captureException(error, { tags: { route: 'fleet/documents/POST' } })
    return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
  }
  return NextResponse.json({ document: data }, { status: 201 })
}

function trimOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
