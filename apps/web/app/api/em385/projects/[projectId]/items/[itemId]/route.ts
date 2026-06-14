import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember, requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { EM385_STATUSES, type Em385Status } from '@soteria/core/em385'

// GET   /api/em385/projects/[projectId]/items/[itemId]  Item + audit + files (member).
// PATCH /api/em385/projects/[projectId]/items/[itemId]  Update status / dates /
//                                                       link / justification (admin).
//
// Status side effects (set server-side, never trusted from the client):
//   - submitted        → stamp submitted_at if not already set
//   - accepted         → stamp accepted_at + accepted_by
//   - leaving accepted → clear accepted_at / accepted_by
// A 'not_applicable' status requires a justification (also a DB CHECK).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ projectId: string; itemId: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId, itemId } = await ctx.params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data: item, error: itemErr } = await gate.authedClient
      .from('em385_register_items')
      .select('*')
      .eq('id', itemId)
      .eq('project_id', projectId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (itemErr) throw new Error(itemErr.message)
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [{ data: audit, error: auditErr }, { data: files, error: filesErr }] = await Promise.all([
      gate.authedClient
        .from('em385_register_item_audit_log')
        .select('id, event_type, before_row, after_row, actor_id, actor_email, context, occurred_at')
        .eq('register_item_id', itemId)
        .order('occurred_at', { ascending: false })
        .limit(50),
      gate.authedClient
        .from('em385_document_files')
        .select('id, register_item_id, storage_path, mime_type, file_size_bytes, file_hash_sha256, version_label, uploaded_by, uploaded_at')
        .eq('register_item_id', itemId)
        .order('uploaded_at', { ascending: false }),
    ])
    if (auditErr) throw new Error(auditErr.message)
    if (filesErr) throw new Error(filesErr.message)

    return NextResponse.json({ item, audit: audit ?? [], files: files ?? [] })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/items/[itemId]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ projectId: string; itemId: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { projectId, itemId } = await ctx.params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(itemId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = {}

  // Free-text / date fields: null clears, string sets.
  for (const key of ['responsible_party', 'due_date', 'effective_date', 'expires_at', 'version', 'linked_record_id', 'linked_module', 'notes', 'not_applicable_justification']) {
    const v = body[key]
    if (v === null) update[key] = null
    else if (typeof v === 'string') update[key] = v.trim() || null
  }

  if (typeof body.status === 'string') {
    if (!(EM385_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }
    const status = body.status as Em385Status
    update.status = status

    if (status === 'submitted') {
      update.submitted_at = new Date().toISOString()
    }
    if (status === 'accepted') {
      update.accepted_at = new Date().toISOString()
      update.accepted_by = gate.userId
    } else {
      // Leaving the accepted state clears the acceptance stamp.
      update.accepted_at = null
      update.accepted_by = null
    }
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No updatable fields supplied' }, { status: 400 })
  }
  update.updated_by = gate.userId

  // Guard the N/A justification requirement before hitting the DB CHECK so the
  // client gets a clear message. Only enforce when this request sets N/A and
  // doesn't also supply a justification (and none is already persisted is
  // handled by the DB CHECK as the backstop).
  if (update.status === 'not_applicable' && update.not_applicable_justification == null) {
    // Allow the case where a justification already exists on the row.
    const { data: existing } = await supabaseAdmin()
      .from('em385_register_items')
      .select('not_applicable_justification')
      .eq('id', itemId)
      .eq('project_id', projectId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!existing?.not_applicable_justification) {
      return NextResponse.json(
        { error: 'A justification is required to mark an item not applicable' },
        { status: 400 },
      )
    }
  }

  try {
    const { data, error } = await supabaseAdmin()
      .from('em385_register_items')
      .update(update)
      .eq('id', itemId)
      .eq('project_id', projectId)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return sanitizeError(error, 'em385/items/[itemId]/PATCH')
    if (!data) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'em385/items/[itemId]/PATCH' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
