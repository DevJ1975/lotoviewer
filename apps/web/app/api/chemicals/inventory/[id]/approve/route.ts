import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

// POST   /api/chemicals/inventory/[id]/approve   → flips 'requested' → 'in_stock'
// DELETE /api/chemicals/inventory/[id]/approve   → flips 'requested' → 'rejected'
//                                                  body { reason: string }
//
// Admin-only (owner / admin role). Pushes the requester so they don't
// have to keep refreshing the queue.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

interface InventoryRow {
  id:           string
  status:       string
  barcode:      string
  product_id:   string
  requested_by: string | null
  chemical_products: { name: string } | { name: string }[] | null
}

function appOrigin(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  return new URL(req.url).origin
}

function pickProductName(row: InventoryRow): string {
  const join = row.chemical_products
  if (!join) return 'Chemical'
  return Array.isArray(join) ? (join[0]?.name ?? 'Chemical') : join.name
}

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('chemical_inventory_items')
      .select('id, status, barcode, product_id, requested_by, chemical_products ( name )')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle<InventoryRow>()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'requested') {
      return NextResponse.json({
        error: `Container is in status "${existing.status}", not "requested".`,
      }, { status: 409 })
    }

    const { data, error } = await admin
      .from('chemical_inventory_items')
      .update({
        status:      'in_stock',
        approved_by: gate.userId,
        updated_by:  gate.userId,
      })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .eq('status', 'requested')        // optimistic concurrency
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Already changed; reload' }, { status: 409 })

    if (existing.requested_by) {
      const productName = pickProductName(existing)
      try {
        await dispatchPushToProfiles({
          payload: {
            title: `Approved: ${productName}`,
            body:  `Container ${existing.barcode} is approved and ready to receive.`,
            url:   `${appOrigin(req)}/chemicals/inventory/${id}`,
            tag:   `chemical-approval:${id}`,
          },
          profileIds: [existing.requested_by],
          source:     'chemicals/approve',
        })
      } catch (pushErr) {
        Sentry.captureException(pushErr, { tags: { route: 'chemicals/approve', stage: 'push' } })
      }
    }
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty OK */ }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!reason) {
    return NextResponse.json({ error: 'reason is required when rejecting' }, { status: 400 })
  }
  if (reason.length > 1000) {
    return NextResponse.json({ error: 'reason too long (max 1000 chars)' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: existing } = await admin
      .from('chemical_inventory_items')
      .select('id, status, barcode, product_id, requested_by, chemical_products ( name )')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle<InventoryRow>()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'requested') {
      return NextResponse.json({
        error: `Container is in status "${existing.status}", not "requested".`,
      }, { status: 409 })
    }

    const { data, error } = await admin
      .from('chemical_inventory_items')
      .update({
        status:           'rejected',
        rejection_reason: reason,
        updated_by:       gate.userId,
      })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .eq('status', 'requested')
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Already changed; reload' }, { status: 409 })

    if (existing.requested_by) {
      const productName = pickProductName(existing)
      try {
        await dispatchPushToProfiles({
          payload: {
            title: `Rejected: ${productName}`,
            body:  `Your request was declined: ${reason.slice(0, 200)}`,
            url:   `${appOrigin(req)}/chemicals/inventory/${id}`,
            tag:   `chemical-approval:${id}`,
          },
          profileIds: [existing.requested_by],
          source:     'chemicals/reject',
        })
      } catch (pushErr) {
        Sentry.captureException(pushErr, { tags: { route: 'chemicals/reject', stage: 'push' } })
      }
    }
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
