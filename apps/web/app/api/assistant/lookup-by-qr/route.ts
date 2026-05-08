import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/assistant/lookup-by-qr?token=<qr_token>
//
// Given a QR token (printed on the equipment placard), resolve to an
// equipment row. Tenant-scoped: a user only gets a hit if the equipment
// belongs to their active tenant. Cross-tenant scans return 404 — we
// don't expose existence of the row to a different tenant's user.
//
// Auth: requireTenantMember + x-active-tenant.

const QR_TOKEN_RE = /^[0-9a-f]{16}$/i

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const token = (url.searchParams.get('token') ?? '').trim()
  if (!QR_TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'Invalid QR token format.' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('loto_equipment')
    .select('id, equipment_id, description, department, tenant_id')
    .eq('qr_token', token)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: '/api/assistant/lookup-by-qr' } })
    return NextResponse.json({ error: 'Lookup failed.' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'No equipment matches that QR.' }, { status: 404 })

  const row = data as { id: string; equipment_id: string; description: string | null; department: string | null; tenant_id: string }
  if (row.tenant_id !== gate.tenantId) {
    // Cross-tenant scan. Refuse without leaking existence: same 404 the
    // not-found branch returns.
    return NextResponse.json({ error: 'No equipment matches that QR.' }, { status: 404 })
  }

  return NextResponse.json({
    equipment: {
      id:           row.id,
      equipment_id: row.equipment_id,
      description:  row.description,
      department:   row.department,
    },
  })
}
