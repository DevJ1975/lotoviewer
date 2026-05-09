import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  INVENTORY_STATUSES,
  CONTAINER_TYPES,
  INVENTORY_UNITS,
  isLegalStatusTransition,
  type InventoryStatus,
} from '@soteria/core/chemicals'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

const PATCHABLE = new Set([
  'location_id', 'department', 'quantity', 'unit', 'container_type',
  'received_date', 'opened_date', 'expiration_date',
  'lot_number', 'manufacture_date', 'status', 'assigned_to',
  'purchase_order', 'cost_cents', 'notes',
  'disposed_method',
])

const ENUM_FIELDS: Record<string, readonly string[]> = {
  status:         INVENTORY_STATUSES,
  container_type: CONTAINER_TYPES,
  unit:           INVENTORY_UNITS,
}

// Fields that must be finite numbers when present. Anything else
// (string, NaN, Infinity, object) is rejected with 400. Without this
// guard, Supabase will accept a string and the column-level CHECK
// is the only line of defence — better to fail clean at the gate.
const NUMERIC_FIELDS = new Set(['quantity', 'cost_cents'])

// Fields that must be ISO date strings (YYYY-MM-DD) when present.
const DATE_FIELDS = new Set([
  'received_date', 'opened_date', 'expiration_date', 'manufacture_date',
])
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// String fields with a hard length cap. Prevents a malicious or
// accidental gigabyte payload from making it to the DB.
const STRING_MAX_LEN: Record<string, number> = {
  department: 200, lot_number: 100, purchase_order: 100,
  notes: 5_000, disposed_method: 200, assigned_to: 200,
}

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('chemical_inventory_items')
      .select(`
        *,
        chemical_products (
          id, name, manufacturer, product_code,
          ghs_signal_word, ghs_pictograms, ppe_required,
          storage_class
        ),
        chemical_locations ( id, name, path, kind )
      `)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ item: data })
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
    if (!PATCHABLE.has(k)) continue

    // Allow `null` to clear an optional field; the type guards below
    // only run on present, non-null values.
    if (v !== null) {
      if (k in ENUM_FIELDS) {
        if (typeof v !== 'string' || !ENUM_FIELDS[k].includes(v)) {
          return NextResponse.json({ error: `${k}: invalid value` }, { status: 400 })
        }
      }
      if (NUMERIC_FIELDS.has(k)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          return NextResponse.json({ error: `${k}: must be a finite number` }, { status: 400 })
        }
      }
      if (DATE_FIELDS.has(k)) {
        if (typeof v !== 'string' || !ISO_DATE_RE.test(v)) {
          return NextResponse.json({ error: `${k}: must be YYYY-MM-DD` }, { status: 400 })
        }
      }
      const maxLen = STRING_MAX_LEN[k]
      if (maxLen !== undefined) {
        if (typeof v !== 'string' || v.length > maxLen) {
          return NextResponse.json({ error: `${k}: must be a string ≤ ${maxLen} chars` }, { status: 400 })
        }
      }
    }
    update[k] = v
  }
  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: 'No editable fields supplied' }, { status: 400 })
  }
  if (update.status === 'disposed' && !update.disposed_method) {
    return NextResponse.json({ error: 'disposed_method is required when status = disposed' }, { status: 400 })
  }
  if (update.status === 'disposed') {
    update.disposed_by = gate.userId
  }

  try {
    const admin = supabaseAdmin()

    // Status-change guard. Two enforcement layers:
    //   1. The data-model state machine (isLegalStatusTransition).
    //   2. The approvals workflow: requested → in_stock | rejected
    //      MUST go through the admin-gated /approve endpoint, never
    //      this PATCH (which is requireTenantMember). Otherwise a
    //      worker could self-approve their own request.
    if (typeof update.status === 'string' && (INVENTORY_STATUSES as readonly string[]).includes(update.status)) {
      const { data: existing, error: fetchErr } = await admin
        .from('chemical_inventory_items')
        .select('status')
        .eq('id', id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
      if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      const current = existing.status as InventoryStatus
      const next    = update.status as InventoryStatus
      if (!isLegalStatusTransition(current, next)) {
        return NextResponse.json({
          error: `Illegal status transition: ${current} → ${next}`,
        }, { status: 409 })
      }
      if (current === 'requested' && (next === 'in_stock' || next === 'rejected')) {
        return NextResponse.json({
          error: 'Approving or rejecting a requested container must go through /approve (admin-only).',
        }, { status: 403 })
      }
    }

    const { data, error } = await admin
      .from('chemical_inventory_items')
      .update(update)
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data)  return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
