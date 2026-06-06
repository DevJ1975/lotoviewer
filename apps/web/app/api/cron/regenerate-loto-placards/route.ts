import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { loadTenantLogoPng, regenerateAndUploadPlacard } from '@/lib/loto/regeneratePlacard'

// Resumable backfill: re-render every active LOTO placard so the stored
// PDF carries the tenant logo + machine QR that #194 added to the
// generator. Most active equipment has no stored placard_url at all (the
// print queue serves that column, so those machines silently drop out of
// "download all"); the rest hold pre-logo PDFs. One pass over the fleet
// fixes both.
//
// Driven by loto_equipment.placard_qr_backfilled (migration 217). Each run
// drains a time-bounded slice and flips finished rows to true, so repeated
// invocations (scheduled or manual) converge on zero remaining. Per-row
// failures stay false and are retried on the next run — no silent skips.

export const runtime = 'nodejs'
export const maxDuration = 300

// Wall-clock budget per invocation. Kept well under maxDuration so the run
// returns a clean summary instead of being killed mid-row. Each placard is
// a few photo fetches + sharp + pdf-lib + upload (~1-3s).
const BUDGET_MS = 120_000
const PAGE_SIZE = 10

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret && bearer && safeEqual(bearer, cronSecret)) return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer && safeEqual(bearer, internalSecret)) return true
  return false
}

export async function GET(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron())
}

type Pending = { tenant_id: string; equipment_id: string }

const keyOf = (r: Pending) => `${r.tenant_id}/${r.equipment_id}`

async function runCron(): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const startedAt = Date.now()

  // One logo fetch + decode per tenant, reused across that tenant's fleet.
  const logoCache = new Map<string, Uint8Array | null>()
  const getLogo = async (tenantId: string): Promise<Uint8Array | null> => {
    const cached = logoCache.get(tenantId)
    if (cached !== undefined) return cached
    const logo = await loadTenantLogoPng(admin, tenantId)
    logoCache.set(tenantId, logo)
    return logo
  }

  // Rows attempted this run. A successful row flips its marker and leaves
  // the query; a failed row stays, so without this set the next page would
  // re-serve the same failures and spin. When a page yields nothing new,
  // only previously-failed rows remain — end the run and let the next
  // invocation retry them.
  const attempted = new Set<string>()
  let succeeded = 0
  const failed: string[] = []

  while (Date.now() - startedAt < BUDGET_MS) {
    const { data: page, error } = await admin
      .from('loto_equipment')
      .select('tenant_id, equipment_id')
      .eq('placard_qr_backfilled', false)
      .or('decommissioned.is.null,decommissioned.eq.false')
      .order('tenant_id', { ascending: true })
      .order('equipment_id', { ascending: true })
      .limit(PAGE_SIZE)
    if (error) throw new Error(`load pending equipment: ${error.message}`)
    if (!page || page.length === 0) break

    const fresh = (page as Pending[]).filter(r => !attempted.has(keyOf(r)))
    if (fresh.length === 0) break

    for (const row of fresh) {
      if (Date.now() - startedAt >= BUDGET_MS) break
      attempted.add(keyOf(row))
      try {
        const logo = await getLogo(row.tenant_id)
        await regenerateAndUploadPlacard(admin, row.tenant_id, row.equipment_id, logo)
        const { error: markErr } = await admin
          .from('loto_equipment')
          .update({ placard_qr_backfilled: true })
          .eq('tenant_id', row.tenant_id)
          .eq('equipment_id', row.equipment_id)
        if (markErr) throw new Error(`mark backfilled: ${markErr.message}`)
        succeeded++
      } catch (e) {
        failed.push(keyOf(row))
        Sentry.captureException(e, {
          tags: { cron: 'regenerate-loto-placards' },
          extra: { tenant_id: row.tenant_id, equipment_id: row.equipment_id },
        })
      }
    }
  }

  const { count: remaining } = await admin
    .from('loto_equipment')
    .select('*', { count: 'exact', head: true })
    .eq('placard_qr_backfilled', false)
    .or('decommissioned.is.null,decommissioned.eq.false')

  return NextResponse.json({
    ok: true,
    succeeded,
    failed: failed.length,
    failedKeys: failed.slice(0, 25),
    remaining: remaining ?? null,
    durationMs: Date.now() - startedAt,
  })
}
