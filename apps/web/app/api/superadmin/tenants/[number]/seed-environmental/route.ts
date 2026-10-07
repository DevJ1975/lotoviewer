import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidTenantNumber } from '@/lib/validation/tenants'
import { describeSummary, seedEnvironmentalDemo } from '@/lib/environmental/demoSeed'
import { supabaseDemoStore } from '@/lib/environmental/demoStore'

// POST /api/superadmin/tenants/[number]/seed-environmental
//
// Seeds (or tops up) the environmental compliance demo on a demo account without
// wiping anything else: three sites in three situations, with permits, outfalls,
// requirements, deadlines and checklist history. Safe to repeat: each step finds
// what it made before and leaves it alone. Reset Demo runs the same seed.
//
// Demo accounts only. The seed creates sites and records named DEMO, which must
// never appear in a customer's real data.

export const runtime = 'nodejs'

export async function POST(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: tenant, error: tenantError } = await admin
    .from('tenants').select('id, tenant_number, name, is_demo').eq('tenant_number', number).maybeSingle()
  if (tenantError) {
    Sentry.captureException(tenantError, { tags: { route: '/api/superadmin/tenants/[number]/seed-environmental', stage: 'tenant-lookup' } })
    return NextResponse.json({ error: tenantError.message }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })
  if (tenant.is_demo !== true) {
    return NextResponse.json({ error: 'Refusing to seed demo data into a non-demo tenant.' }, { status: 403 })
  }

  try {
    const summary = await seedEnvironmentalDemo(supabaseDemoStore(admin, tenant.id as string), new Date())
    return NextResponse.json({ ok: true, tenant: { id: tenant.id, tenant_number: tenant.tenant_number }, summary, message: describeSummary(summary) })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/superadmin/tenants/[number]/seed-environmental', stage: 'seed' } })
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Seeding failed' }, { status: 500 })
  }
}
