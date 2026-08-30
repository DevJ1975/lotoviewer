import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import {
  planQuery,
  availableMetrics,
  DIMENSIONS,
  type CatalogQuery,
  type DimensionId,
  type TimeGrain,
} from '@soteria/core/semanticCatalog'
import { poissonCountInterval } from '@soteria/core/statistics'

// POST /api/insights/olap
//
// The execution half of the semantic catalog: turns a bounded metric selection
// into grouped counts, with the numbers an honest answer needs attached.
//
// Three properties make this safe to put behind an AI tool, and all three are
// enforced here rather than asked for in a prompt:
//
//  1. NO SQL CROSSES THE BOUNDARY. The caller sends a metric id, dimension ids
//     and a grain, all validated against the catalog. Anything not in the
//     catalog is refused. A model calling this cannot express a query the
//     catalog does not already sanction.
//  2. IT RUNS AS THE USER. Reads go through gate.authedClient, so tenant and
//     facility isolation come from row-level security rather than from a
//     WHERE clause we remembered to add. The service-role client is
//     deliberately not used — under it the facility header does not apply and
//     every answer would silently widen to the whole client.
//  3. IT REFUSES. A metric whose definition cannot yet be reported honestly —
//     a rate whose denominator will not follow a facility filter, a series
//     whose write path is split — returns 422 with the reason rather than a
//     plausible number. A layer that answers everything is more dangerous than
//     one that explains what it cannot answer.
//
// Every response carries `disclosures` and an interval. Callers must render
// them; prose is the most persuasive surface in the product and the only one
// with no error bars.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Below this many events in a bucket, report the count but draw no conclusion. */
const MIN_BUCKET_N = 10

const GRAINS: readonly TimeGrain[] = ['month', 'quarter', 'year']

function bucketKey(iso: string, grain: TimeGrain): string | null {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const d = new Date(ms)
  const y = d.getUTCFullYear()
  if (grain === 'year') return String(y)
  if (grain === 'quarter') return `${y}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`
  return d.toISOString().slice(0, 7)
}

export async function POST(req: NextRequest) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Partial<CatalogQuery>
  try {
    body = (await req.json()) as Partial<CatalogQuery>
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }

  const grain: TimeGrain = GRAINS.includes(body.grain as TimeGrain)
    ? (body.grain as TimeGrain)
    : 'month'

  const knownDimensions = new Set(DIMENSIONS.map(d => d.id))
  const requested = Array.isArray(body.dimensions) ? body.dimensions : []
  const unknown = requested.filter(d => !knownDimensions.has(d as DimensionId))
  if (unknown.length > 0) {
    return NextResponse.json(
      {
        error: `Unknown dimension(s): ${unknown.join(', ')}.`,
        availableDimensions: DIMENSIONS.map(d => d.id),
      },
      { status: 400 },
    )
  }

  const planned = planQuery({
    metricId:   String(body.metricId ?? ''),
    dimensions: requested as DimensionId[],
    grain,
    from:       String(body.from ?? ''),
    to:         String(body.to ?? ''),
    facilityId: gate.facilityId,
  })

  if (!planned.ok) {
    // 422, not 400: the request was well-formed, the answer is unavailable.
    return NextResponse.json(
      {
        error: planned.error,
        availableMetrics: availableMetrics().map(m => ({ id: m.id, label: m.label })),
      },
      { status: 422 },
    )
  }

  const { plan } = planned

  try {
    const groupCols = plan.groupBy.filter(c => c !== plan.timeColumn)
    const select = [plan.timeColumn, ...groupCols].join(', ')

    const { data, error } = await gate.authedClient
      .from(plan.table)
      .select(select)
      .gte(plan.timeColumn, plan.from)
      .lte(plan.timeColumn, plan.to)

    if (error) {
      Sentry.captureException(error, { tags: { route: 'insights/olap' } })
      return NextResponse.json({ error: 'Query failed.' }, { status: 500 })
    }

    const rows = (data ?? []) as unknown as Array<Record<string, string | null>>
    const buckets = new Map<string, number>()
    for (const row of rows) {
      const iso = row[plan.timeColumn]
      if (!iso) continue
      const period = bucketKey(iso, grain)
      if (!period) continue
      const key = [period, ...groupCols.map(c => row[c] ?? 'unassigned')].join(' | ')
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }

    const results = Array.from(buckets.entries())
      .map(([key, n]) => {
        const [period, ...groups] = key.split(' | ')
        const ci = poissonCountInterval(n)
        return {
          period,
          groups: Object.fromEntries(groupCols.map((c, i) => [c, groups[i]])),
          n,
          interval: { lower: ci.lower, upper: ci.upper },
          // Honest by construction: a thin bucket reports its count and
          // declines to support a comparison built on it.
          comparable: n >= MIN_BUCKET_N,
        }
      })
      .sort((a, b) => a.period.localeCompare(b.period))

    return NextResponse.json({
      metric: {
        id: plan.metric.id,
        label: plan.metric.label,
        unit: plan.metric.unit,
        formula: plan.metric.formula,
        grain: plan.metric.grain,
        denominator: plan.metric.denominator,
      },
      window: { from: plan.from, to: plan.to, grain },
      scope: gate.facilityId ? 'facility' : 'tenant',
      totalRows: rows.length,
      minComparableN: MIN_BUCKET_N,
      results,
      disclosures: plan.disclosures,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'insights/olap' } })
    return NextResponse.json({ error: 'Query failed.' }, { status: 500 })
  }
}
