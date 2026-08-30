import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'

// POST /api/admin/loto/review-queue
//   Body: { equipment_id: string, action: 'clear' | 'flag', reason?: string }
//
// Tenant-admin-only mutation of the loto_equipment review flag. The
// "queue" itself is read directly from loto_equipment by the page
// component via RLS-scoped supabase-js — there's no GET here. Two
// actions:
//   - `clear`: null the flag columns. Use when the admin has reviewed
//     the equipment and either fixed the underlying issue or accepted
//     the current state.
//   - `flag`:  an admin marking equipment for follow-up themselves
//     (the public link's supervisor path uses /api/review/[token]
//     with the mark-for-review action). Sets via='admin'.

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { equipment_id?: unknown; action?: unknown; reason?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const equipmentId = typeof body.equipment_id === 'string' ? body.equipment_id.trim() : ''
  const action      = typeof body.action === 'string' ? body.action : ''
  const reason      = typeof body.reason === 'string' ? body.reason.trim() : ''
  if (!equipmentId) return NextResponse.json({ error: 'equipment_id required' }, { status: 400 })
  if (action !== 'clear' && action !== 'flag') {
    return NextResponse.json({ error: 'action must be clear or flag' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const patch = action === 'clear'
    ? {
        flagged_for_review_at:   null,
        flagged_for_review_by:   null,
        flagged_for_review_via:  null,
        flagged_for_review_note: null,
      }
    : {
        flagged_for_review_at:   new Date().toISOString(),
        flagged_for_review_by:   gate.userEmail ?? gate.userId,
        flagged_for_review_via:  'admin',
        flagged_for_review_note: reason || null,
      }

  const { data, error } = await admin
    .from('loto_equipment')
    .update(patch)
    .eq('tenant_id',   gate.tenantId)
    .eq('equipment_id', equipmentId)
    .select('equipment_id, flagged_for_review_at')
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'admin/loto/review-queue' } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Equipment not found' }, { status: 404 })

  return NextResponse.json({ equipment: data })
}
