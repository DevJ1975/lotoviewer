import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  CHEMICAL_TRAINING_ROLES,
  type ChemicalTrainingRole,
} from '@soteria/core/chemicals'

// GET  /api/chemicals/products/[id]/training-requirements
//      List the training roles required to handle this chemical.
// POST /api/chemicals/products/[id]/training-requirements
//      body { role: ChemicalTrainingRole, notes?: string }
//      Idempotent on UNIQUE (tenant_id, product_id, role).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_training_requirements')
      .select('id, product_id, role, notes, created_at, created_by')
      .eq('tenant_id', gate.tenantId)
      .eq('product_id', id)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requirements: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const roleRaw = typeof body.role === 'string' ? body.role : ''
  if (!(CHEMICAL_TRAINING_ROLES as readonly string[]).includes(roleRaw)) {
    return NextResponse.json({
      error: `role must be one of: ${CHEMICAL_TRAINING_ROLES.join(', ')}`,
    }, { status: 400 })
  }
  const role = roleRaw as ChemicalTrainingRole
  const notes = typeof body.notes === 'string' && body.notes.trim()
    ? body.notes.trim().slice(0, 500) : null

  try {
    const admin = supabaseAdmin()
    // Confirm product belongs to this tenant.
    const { data: product } = await admin
      .from('chemical_products')
      .select('id, archived_at')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

    // UPSERT-style insert: UNIQUE (tenant, product, role) makes
    // re-adding idempotent and lets the caller bump notes.
    const { data, error } = await admin
      .from('chemical_training_requirements')
      .upsert({
        tenant_id:  gate.tenantId,
        product_id: id,
        role,
        notes,
        created_by: gate.userId,
      }, { onConflict: 'tenant_id,product_id,role' })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ requirement: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
