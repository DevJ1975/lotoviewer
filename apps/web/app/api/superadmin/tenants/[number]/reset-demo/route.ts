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
//   Every seed function in SEED_FUNCTIONS runs, in order, against any tenant
//   with is_demo = true. A function missing from the database (42883 /
//   PGRST202) is skipped so a partially-migrated DB still resets.
//
//   This used to be gated on `tenant_number === '0002'`, which meant a second
//   demo tenant was wiped and never re-seeded — audit item A10 in
//   apps/web/docs/multi-tenancy-audit-plan.md. The seeds resolve their own
//   tenant by `is_demo`, so the tenant-number check was both wrong and
//   redundant.
//
// WIPED BUT DELIBERATELY NOT SEEDED:
//   Three tables in DELETE_ORDER have no seed and should not get one. They
//   are registrations and audit trails, not demo content, and an empty table
//   after a reset is the correct outcome:
//     - loto_hygiene_log         written only by hand-run hygiene SQL
//     - loto_push_subscriptions  per-browser Web Push registrations
//     - loto_webhook_subscriptions  per-integration endpoints
//
//   Anything else added to DELETE_ORDER needs a matching seed, or the module
//   it belongs to silently empties on every reset and never comes back. That
//   is exactly how Equipment Readiness was lost.

const DELETE_ORDER: readonly string[] = [
  // Children (FK to a parent in this list).
  'loto_energy_steps',
  'loto_atmospheric_tests',
  'loto_confined_space_entries',
  'loto_device_checkouts',
  'loto_meter_alerts',
  'equipment_inspection_responses',
  'equipment_evidence',
  'equipment_repairs',
  'equipment_defects',
  'equipment_inspections',
  'equipment_operator_authorizations',
  'bbs_observation_photos',
  'bbs_observation_actions',
  'bbs_observations',
  'position_training_requirements',
  'position_equipment_requirements',
  'worker_position_assignments',
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
  'worker_positions',
  'bbs_qr_locations',
  // Audit log goes last so the wipe itself is captured (the rows being
  // deleted include rows that recorded the deletes — the row counts in
  // the response are correct as of the start-of-request snapshot).
  'audit_log',
]

// Seed functions, in dependency order. seed_wls_demo() lays down the
// equipment, spaces and permits every later seed references, so it is first.
//
// Adding a seed migration means adding it here. A function that exists in the
// database but is not listed never runs on reset, so its module stays empty
// until someone calls it by hand.
const SEED_FUNCTIONS = [
  'seed_wls_demo',
  'seed_wls_worker_readiness_demo',
  'seed_wls_incidents_demo',
  'seed_wls_near_miss_demo',
  'seed_wls_bbs_demo',
  'seed_wls_equipment_readiness_demo',
] as const

/** Postgres/PostgREST codes meaning "this function is not in the database". */
const MISSING_FUNCTION_CODES = new Set(['42883', 'PGRST202'])

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

  // Re-seed. Every function runs against any demo tenant; each resolves the
  // demo tenant itself by is_demo. A function absent from this database is
  // skipped so older/partial schemas still reset cleanly.
  const seedMessages: string[] = []
  const seedsMissing: string[] = []

  for (const fn of SEED_FUNCTIONS) {
    const { data, error: seedErr } = await admin.rpc(fn)
    if (seedErr) {
      const code = (seedErr as { code?: string }).code
      if (code && MISSING_FUNCTION_CODES.has(code)) {
        seedsMissing.push(fn)
        continue
      }
      Sentry.captureException(seedErr, { tags: { route: '/api/superadmin/tenants/[number]/reset-demo', stage: `rpc-${fn}` } })
      return NextResponse.json({
        error: `Re-seed (${fn}) failed: ${seedErr.message}`,
        wiped,
      }, { status: 500 })
    }
    if (typeof data === 'string') seedMessages.push(data)
  }

  const seedResult = seedMessages.length > 0 ? seedMessages.join('; ') : null
  // Only true when the database has none of the seed functions at all — not
  // when a single optional one is missing.
  const seedSkipped = seedsMissing.length === SEED_FUNCTIONS.length

  return NextResponse.json({
    ok: true,
    tenant: { id: tenant.id, tenant_number: tenant.tenant_number },
    wiped,
    skipped,
    seed:    seedResult,
    seedSkipped,
    // Surfaced so a partially-migrated database is visible rather than
    // silently under-seeded — the failure mode this route already had.
    seedsMissing,
    note: seedSkipped
      ? 'No seed functions found in this database — only the wipe ran. Apply the seed migrations to re-seed.'
      : seedsMissing.length > 0
        ? `Wiped and re-seeded. ${seedsMissing.length} seed function(s) not present in this database: ${seedsMissing.join(', ')}.`
        : 'Wiped and re-seeded canonical demo data.',
  })
}
