import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/incidents/qr-tokens/activity?days=30
//
// Returns daily report counts per token over the requested window
// so the admin list can render a sparkline next to each row. Cheap
// aggregate query — no JOINs, no full table scan thanks to the
// (tenant_id, reported_at desc) index on incidents.
//
// Response shape:
//   {
//     window_days: 30,
//     buckets: ['2026-04-09', '2026-04-10', ...],
//     activity: { <token_id>: number[] }   // length == buckets.length
//   }
//
// Buckets are returned ascending (oldest → newest) so the sparkline
// renders left-to-right without re-sorting on the client.

const DEFAULT_DAYS = 30
const MAX_DAYS     = 90

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const days = clamp(Number(url.searchParams.get('days') ?? DEFAULT_DAYS), 1, MAX_DAYS)

  try {
    const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000
    const sinceIso = new Date(sinceMs).toISOString()

    const { data, error } = await gate.authedClient
      .from('incidents')
      .select('anon_token_id, reported_at')
      .eq('tenant_id', gate.tenantId)
      .eq('is_anonymous', true)
      .not('anon_token_id', 'is', null)
      .gte('reported_at', sinceIso)
    if (error) throw new Error(error.message)

    const buckets = buildBuckets(days)
    const indexByDate = new Map(buckets.map((d, i) => [d, i]))
    const activity: Record<string, number[]> = {}

    for (const row of (data ?? []) as Array<{ anon_token_id: string; reported_at: string }>) {
      const day = row.reported_at.slice(0, 10)
      const idx = indexByDate.get(day)
      if (idx == null) continue
      const series = activity[row.anon_token_id] ??= new Array(buckets.length).fill(0)
      series[idx] += 1
    }

    return NextResponse.json({ window_days: days, buckets, activity })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'qr-tokens/activity' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

function buildBuckets(days: number): string[] {
  const out: string[] = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 24 * 60 * 60 * 1000)
    out.push(d.toISOString().slice(0, 10))
  }
  return out
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}
