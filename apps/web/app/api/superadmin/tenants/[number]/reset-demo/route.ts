import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidTenantNumber } from '@/lib/validation/tenants'

// POST /api/superadmin/tenants/[number]/reset-demo
//
// Wipes every domain row carrying tenant_id = <demo tenant id>. The tenant
// row itself, its memberships, and its settings are preserved — only the
// in-tenant data goes away.
//
// SAFETY:
//   1. requireSuperadmin (env allowlist + DB flag)
//   2. Hard-fail if tenant.is_demo !== true. Reset Demo on Snak King would
//      destroy real production data; this check is the last line of defense
//      and runs even after the route guard.
//
// FK ORDER:
//   Children (loto_energy_steps, loto_atmospheric_tests, …) before parents
//   (loto_equipment, loto_confined_space_permits, …). Order matters because
//   we use plain DELETE — no CASCADE — so a child row would block the
//   parent's delete.
//
// SEEDING:
//   For WLS Demo (#0002), this RPCs into seed_wls_demo() defined in
//   migration 030 to restore canonical demo data. Other is_demo tenants
//   without a seed function are wiped only — the response surfaces
//   seedSkipped:true so the UI explains.

const DELETE_ORDER: readonly string[] = [
  // Children (FK to a parent in this list).
  'loto_energy_steps',
  'loto_atmospheric_tests',
  'loto_confined_space_entries',
  'loto_device_checkouts',
  'loto_meter_alerts',
  // Parents.
  'loto_equipment',
  'loto_confined_space_permits',
  'loto_confined_spaces',
  'loto_hot_work_permits',
  'loto_devices',
  'loto_gas_meters',
  'loto_reviews',
  'loto_training_records',
  'loto_webhook_subscriptions',
  'loto_push_subscriptions',
  'loto_hygiene_log',
  // Audit log goes last so the wipe itself is captured (the rows being
  // deleted include rows that recorded the deletes — the row counts in
  // the response are correct as of the start-of-request snapshot).
  'audit_log',
]

export async function POST(req: Request, ctx: { params: Promise<{ number: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { number } = await ctx.params
  if (!isValidTenantNumber(number)) {
    return NextResponse.json({ error: 'Invalid tenant number' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  const { data: tenant, error: tErr } = await admin
    .from('tenants')
    .select('id, tenant_number, name, is_demo')
    .eq('tenant_number', number)
    .maybeSingle()
  if (tErr) {
    Sentry.captureException(tErr, { tags: { route: '/api/superadmin/tenants/[number]/reset-demo', stage: 'tenant-lookup' } })
    return NextResponse.json({ error: tErr.message }, { status: 500 })
  }
  if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 })

  // Hard safety: never wipe a non-demo tenant. The button on the tenant
  // edit page is hidden when is_demo is false, but the API route enforces
  // it independently in case someone replays the request.
  if (!tenant.is_demo) {
    return NextResponse.json({
      error: `Refusing to wipe non-demo tenant "${tenant.name}" (#${tenant.tenant_number}). Set is_demo = true first if this was intentional.`,
    }, { status: 403 })
  }

  const wiped: Record<string, number> = {}
  const skipped: string[] = []

  for (const t of DELETE_ORDER) {
    // Self-healing: tables that don't exist on this DB return Postgres
    // 42P01; we treat that as "skip" rather than an error so a partial-
    // schema deployment still resets cleanly.
    try {
      const { error: delErr, count } = await admin
        .from(t)
        .delete({ count: 'exact' })
        .eq('tenant_id', tenant.id)

      if (delErr) {
        const code = (delErr as { code?: string }).code
        if (code === '42P01') {
          skipped.push(t)
          continue
        }
        Sentry.captureException(delErr, { tags: { route: '/api/superadmin/tenants/[number]/reset-demo', stage: 'wipe' } })
        return NextResponse.json({
          error: `Wipe failed at ${t}: ${delErr.message}`,
          wiped,
        }, { status: 500 })
      }
      wiped[t] = count ?? 0
    } catch (err) {
      Sentry.captureException(err, { tags: { route: '/api/superadmin/tenants/[number]/reset-demo', stage: 'error' } })
      return NextResponse.json({
        error: `Unexpected error at ${t}`,
        wiped,
      }, { status: 500 })
    }
  }

  // Re-seed canonical demo data via the SQL function defined in
  // migration 030. Slug-based, so this only works for slug='wls-demo'
  // today; future demo tenants would need their own seed function.
  let seedResult: string | null = null
  let seedSkipped = false
  if (tenant.tenant_number === '0002') {
    const { data, error: seedErr } = await admin.rpc('seed_wls_demo')
    if (seedErr) {
      Sentry.captureException(seedErr, { tags: { route: '/api/superadmin/tenants/[number]/reset-demo', stage: 'rpc-seed' } })
      return NextResponse.json({
        error: `Re-seed failed: ${seedErr.message}`,
        wiped,
      }, { status: 500 })
    }
    seedResult = typeof data === 'string' ? data : null
  } else {
    seedSkipped = true
  }

  return NextResponse.json({
    ok: true,
    tenant: { id: tenant.id, tenant_number: tenant.tenant_number },
    wiped,
    skipped,
    seed:    seedResult,
    seedSkipped,
    note: seedSkipped
      ? 'No seed function for this tenant — only the wipe ran. WLS Demo (#0002) auto-reseeds.'
      : 'Wiped and re-seeded canonical demo data.',
  })
}
