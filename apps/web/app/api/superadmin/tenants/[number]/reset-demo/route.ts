import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isValidTenantNumber } from '@/lib/validation/tenants'
import { DELETE_ORDER, SEED_FUNCTIONS } from '@/lib/demoReset'

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
// FK ORDER, SEEDING, and the tables wiped but deliberately not seeded:
//   see lib/demoReset.ts, which holds both lists.

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
