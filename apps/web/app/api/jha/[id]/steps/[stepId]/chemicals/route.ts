import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET  /api/jha/[id]/steps/[stepId]/chemicals
//      List the chemicals linked to this JHA step + the per-chemical
//      ppe_required so the UI can render derived PPE without a
//      second round-trip.
//
// POST /api/jha/[id]/steps/[stepId]/chemicals
//      body { product_id, usage_notes?: string }
//      Add a chemical link. UNIQUE (step_id, product_id) makes
//      this idempotent — re-adding returns the existing row.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string; stepId: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: jhaId, stepId } = await ctx.params
  if (!UUID_RE.test(jhaId) || !UUID_RE.test(stepId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  try {
    const { data, error } = await gate.authedClient
      .from('jha_step_chemicals')
      .select(`
        id, step_id, product_id, usage_notes, created_at, created_by,
        chemical_products (
          id, name, manufacturer,
          ghs_signal_word, ghs_pictograms,
          ppe_required, storage_class,
          archived_at
        )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('step_id', stepId)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ links: data ?? [] })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id: jhaId, stepId } = await ctx.params
  if (!UUID_RE.test(jhaId) || !UUID_RE.test(stepId)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const productId = typeof body.product_id === 'string' ? body.product_id : ''
  if (!UUID_RE.test(productId)) {
    return NextResponse.json({ error: 'product_id is required' }, { status: 400 })
  }

  const usageNotes = typeof body.usage_notes === 'string' && body.usage_notes.trim()
    ? body.usage_notes.trim().slice(0, 500)
    : null

  try {
    const admin = supabaseAdmin()

    // Confirm step + product belong to this tenant. RLS would catch
    // it, but a clean 404 is friendlier than a constraint error.
    const [{ data: step }, { data: product }] = await Promise.all([
      admin.from('jha_steps')
        .select('id, jha_id')
        .eq('id', stepId)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle<{ id: string; jha_id: string }>(),
      admin.from('chemical_products')
        .select('id, archived_at')
        .eq('id', productId)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle<{ id: string; archived_at: string | null }>(),
    ])
    if (!step)    return NextResponse.json({ error: 'Step not found' }, { status: 404 })
    if (step.jha_id !== jhaId) {
      return NextResponse.json({ error: 'Step does not belong to this JHA' }, { status: 400 })
    }
    if (!product) return NextResponse.json({ error: 'Chemical not found' }, { status: 404 })
    if (product.archived_at) {
      return NextResponse.json({ error: 'Cannot link an archived chemical' }, { status: 409 })
    }

    // Upsert-style insert: UNIQUE (step_id, product_id) → on conflict
    // bump usage_notes to the new value if supplied, otherwise leave.
    const { data, error } = await admin
      .from('jha_step_chemicals')
      .upsert({
        tenant_id:   gate.tenantId,
        step_id:     stepId,
        product_id:  productId,
        usage_notes: usageNotes,
        created_by:  gate.userId,
      }, { onConflict: 'step_id,product_id' })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ link: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
