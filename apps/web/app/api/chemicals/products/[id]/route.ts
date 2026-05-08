import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET    /api/chemicals/products/[id]    Product + active SDS + revisions.
// PATCH  /api/chemicals/products/[id]    Update editable fields.
// DELETE /api/chemicals/products/[id]    Soft-archive (sets archived_at).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const PATCHABLE_FIELDS = new Set([
  'name', 'manufacturer', 'product_code',
  'cas_numbers', 'synonyms',
  'physical_state',
  'ghs_pictograms', 'ghs_signal_word',
  'hazard_statements', 'precautionary_statements',
  'nfpa_health', 'nfpa_flammability', 'nfpa_instability', 'nfpa_special',
  'ppe_required',
  'flash_point_c', 'boiling_point_c', 'vapor_pressure_kpa',
  'pel_twa_ppm', 'stel_ppm', 'idlh_ppm',
  'first_aid', 'firefighting', 'spill_cleanup',
  'storage_class', 'incompatibilities',
  'dot_un_number', 'dot_hazard_class', 'dot_packing_group',
  'sds_revision_date', 'sds_source_url',
  'active_sds_id',
  'notes',
])

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data: product, error: pErr } = await gate.authedClient
      .from('chemical_products')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (pErr) throw new Error(pErr.message)
    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { data: revisions, error: sErr } = await gate.authedClient
      .from('chemical_sds_documents')
      .select('id, revision_date, language, storage_path, file_bytes, source, parse_review_status, parse_model, parse_confidence, superseded_at, created_at, created_by')
      .eq('product_id', id)
      .eq('tenant_id', gate.tenantId)
      .order('revision_date', { ascending: false, nullsFirst: false })
      .order('created_at',    { ascending: false })
    if (sErr) throw new Error(sErr.message)

    return NextResponse.json({ product, revisions: revisions ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_by: gate.userId }
  for (const [k, v] of Object.entries(body)) {
    if (PATCHABLE_FIELDS.has(k)) update[k] = v
  }
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_products')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ product: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('chemical_products')
      .update({ archived_at: new Date().toISOString(), updated_by: gate.userId })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .is('archived_at', null)
      .select('id')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found or already archived' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
