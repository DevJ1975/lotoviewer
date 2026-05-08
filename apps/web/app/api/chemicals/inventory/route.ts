import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'
import {
  validateInventoryInput,
  ACTIVE_INVENTORY_STATUSES,
  INVENTORY_STATUSES,
  type InventoryItemInput,
  type InventoryStatus,
  type InventoryUnit,
  type ContainerType,
} from '@soteria/core/chemicals'

// GET  /api/chemicals/inventory   List, filterable.
// POST /api/chemicals/inventory   Add a container; allocates barcode if omitted.

const VALID_SORTS = ['created_at', 'expiration_date', 'received_date', 'barcode'] as const
const VALID_DIRS  = ['asc', 'desc'] as const

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const productId  = url.searchParams.get('product_id')
  const locationId = url.searchParams.get('location_id')
  const statusRaw  = url.searchParams.get('status')
  const expiring   = url.searchParams.get('expiring') === 'true'
  const includeDisposed = url.searchParams.get('include_disposed') === 'true'

  const sortRaw = url.searchParams.get('sort')
  const sort = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as typeof VALID_SORTS[number]) : 'created_at'
  const dirRaw = url.searchParams.get('dir')
  const dir = (VALID_DIRS as readonly string[]).includes(dirRaw ?? '')
    ? (dirRaw as typeof VALID_DIRS[number]) : 'desc'

  const limit  = Math.min(500, Math.max(1, parseInt(url.searchParams.get('limit')  ?? '200', 10) || 200))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  try {
    let q = gate.authedClient
      .from('chemical_inventory_items')
      .select(`
        id, product_id, location_id, department, barcode,
        quantity, unit, container_type,
        received_date, opened_date, expiration_date,
        lot_number, manufacture_date, status,
        assigned_to, purchase_order, cost_cents,
        notes, disposed_at, disposed_method,
        created_at, updated_at,
        chemical_products (
          id, name, manufacturer, ghs_signal_word, ghs_pictograms, archived_at
        ),
        chemical_locations ( id, name, path )
      `, { count: 'exact' })
      .eq('tenant_id', gate.tenantId)

    if (productId)  q = q.eq('product_id',  productId)
    if (locationId) q = q.eq('location_id', locationId)

    if (statusRaw) {
      const statuses = statusRaw.split(',').map(s => s.trim()).filter(
        (s): s is InventoryStatus => (INVENTORY_STATUSES as readonly string[]).includes(s),
      )
      if (statuses.length > 0) q = q.in('status', statuses)
    } else if (!includeDisposed) {
      q = q.in('status', ACTIVE_INVENTORY_STATUSES)
    }

    if (expiring) {
      const cutoff = new Date()
      cutoff.setUTCDate(cutoff.getUTCDate() + 60)
      q = q.lte('expiration_date', cutoff.toISOString().slice(0, 10))
           .not('expiration_date', 'is', null)
    }

    q = q.order(sort, { ascending: dir === 'asc', nullsFirst: false })
         .range(offset, offset + limit - 1)

    const { data, count, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ items: data ?? [], total: count ?? 0, limit, offset })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const input: InventoryItemInput = {
    product_id:    typeof body.product_id === 'string' ? body.product_id : '',
    location_id:   typeof body.location_id === 'string' && body.location_id ? body.location_id : null,
    department:    typeof body.department === 'string' && body.department.trim() ? body.department.trim() : null,
    barcode:       typeof body.barcode === 'string' && body.barcode.trim() ? body.barcode.trim() : null,
    quantity:      typeof body.quantity === 'number' ? body.quantity : Number(body.quantity ?? 0),
    unit:          (typeof body.unit === 'string' ? body.unit : 'ea') as InventoryUnit,
    container_type: typeof body.container_type === 'string' ? body.container_type as ContainerType : null,
    received_date:  typeof body.received_date === 'string' && body.received_date ? body.received_date : null,
    opened_date:    typeof body.opened_date === 'string' && body.opened_date ? body.opened_date : null,
    expiration_date: typeof body.expiration_date === 'string' && body.expiration_date ? body.expiration_date : null,
    lot_number:     typeof body.lot_number === 'string' && body.lot_number.trim() ? body.lot_number.trim() : null,
    manufacture_date: typeof body.manufacture_date === 'string' && body.manufacture_date ? body.manufacture_date : null,
    status:         (typeof body.status === 'string' ? body.status : 'in_stock') as InventoryStatus,
    assigned_to:    typeof body.assigned_to === 'string' && body.assigned_to ? body.assigned_to : null,
    purchase_order: typeof body.purchase_order === 'string' && body.purchase_order.trim() ? body.purchase_order.trim() : null,
    cost_cents:     typeof body.cost_cents === 'number' ? body.cost_cents : null,
    notes:          typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
  }

  const errors = validateInventoryInput(input)
  if (errors.length > 0) {
    return NextResponse.json({
      error: errors.map(e => `${e.field}: ${e.message}`).join('; '),
    }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()

    // Confirm the product belongs to this tenant before allocating a
    // barcode. (RLS would also catch it, but we want a clean 404.)
    const { data: product, error: pErr } = await admin
      .from('chemical_products')
      .select('id, archived_at')
      .eq('id', input.product_id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (pErr)     return NextResponse.json({ error: pErr.message }, { status: 500 })
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    if (product.archived_at) {
      return NextResponse.json({ error: 'Cannot add inventory for an archived chemical' }, { status: 409 })
    }

    let barcode = input.barcode
    if (!barcode) {
      const { data: gen, error: bErr } = await admin
        .rpc('chemical_next_barcode', { p_tenant: gate.tenantId })
      if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })
      barcode = gen as unknown as string
    }

    const { data, error } = await admin
      .from('chemical_inventory_items')
      .insert({
        tenant_id:  gate.tenantId,
        created_by: gate.userId,
        updated_by: gate.userId,
        ...input,
        barcode,
      })
      .select('*')
      .single()
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) {
        return NextResponse.json({ error: `Barcode "${barcode}" is already in use.` }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // Push fanout to tenant admins when this row needs their review.
    if (data.status === 'requested') {
      try {
        const { data: admins } = await admin
          .from('tenant_memberships')
          .select('user_id')
          .eq('tenant_id', gate.tenantId)
          .in('role', ['owner', 'admin'])
        const profileIds = Array.from(new Set(
          (admins ?? []).map(a => a.user_id).filter((u): u is string => !!u),
        ))
        if (profileIds.length > 0) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, '')
            ?? new URL(req.url).origin
          await dispatchPushToProfiles({
            payload: {
              title: 'Chemical container request filed',
              body:  `${product?.id ? '' : ''}A new container request is awaiting review.`,
              url:   `${appUrl}/chemicals/approvals`,
              tag:   `chemical-approval-queue`,
            },
            profileIds,
            source: 'chemicals/request-filed',
          })
        }
      } catch (pushErr) {
        Sentry.captureException(pushErr, { tags: { route: 'chemicals/inventory', stage: 'request-push' } })
      }
    }

    return NextResponse.json({ item: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
