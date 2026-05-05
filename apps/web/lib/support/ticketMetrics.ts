// Pure aggregator for the support-tickets metrics dashboard.
//
// Lives apart from the route so it has zero Supabase dependency
// and can be unit-tested with plain row arrays. The
// /api/superadmin/support-metrics route fetches rows in a window
// and pipes them through these helpers; that keeps lifecycle
// classification, time-to-resolve math, and group-by logic in
// one place.
//
// "Priority" in the UI maps to the existing reason enum:
//   safety_critical → P0  (red)
//   low_confidence  → P1  (amber)
//   user_requested  → P2  (slate)
// We keep storing reason in the DB; the priority label is
// derived here so a future change to the priority scheme
// doesn't require a migration.

export type TicketReason = 'user_requested' | 'low_confidence' | 'safety_critical'

export interface MetricsTicketRow {
  id:           string
  reason:       TicketReason
  tenant_id:    string | null
  tenant_name:  string | null
  emailed_ok:   boolean | null
  resolved_at:  string | null
  archived_at:  string | null
  created_at:   string
}

export type Lifecycle = 'open' | 'resolved' | 'archived'

export function lifecycleOf(row: MetricsTicketRow): Lifecycle {
  if (row.archived_at) return 'archived'
  if (row.resolved_at) return 'resolved'
  return 'open'
}

export const PRIORITY_ORDER: Record<TicketReason, number> = {
  safety_critical: 0,
  low_confidence:  1,
  user_requested:  2,
}

export const PRIORITY_LABEL: Record<TicketReason, string> = {
  safety_critical: 'P0 — Safety',
  low_confidence:  'P1 — Bot stuck',
  user_requested:  'P2 — User asked',
}

export interface MetricsSummary {
  totals: {
    all:          number
    open:         number
    resolved:     number
    archived:     number
    emailFailed:  number
  }
  byPriority: Array<{
    reason:    TicketReason
    label:     string
    open:      number
    resolved:  number
    archived:  number
    total:     number
  }>
  byTenant: Array<{
    tenantId:    string | null
    tenantName:  string | null
    open:        number
    resolved:    number
    archived:    number
    total:       number
  }>
  resolutionMs: {
    count:   number    // # of tickets contributing (resolved or archived)
    median:  number | null
    p90:     number | null
    mean:    number | null
  }
  daily: Array<{
    day:      string   // YYYY-MM-DD UTC
    opened:   number
    resolved: number
  }>
  oldestOpenAgeDays: number | null
}

interface TenantAccum {
  tenantName: string | null
  open:       number
  resolved:   number
  archived:   number
  total:      number
}

interface DailyAccum {
  opened:   number
  resolved: number
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * q
  const lo  = Math.floor(pos)
  const hi  = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function aggregateMetrics(rows: MetricsTicketRow[], now: Date = new Date()): MetricsSummary {
  const totals = { all: 0, open: 0, resolved: 0, archived: 0, emailFailed: 0 }

  const byPriorityMap: Record<TicketReason, { open: number; resolved: number; archived: number; total: number }> = {
    safety_critical: { open: 0, resolved: 0, archived: 0, total: 0 },
    low_confidence:  { open: 0, resolved: 0, archived: 0, total: 0 },
    user_requested:  { open: 0, resolved: 0, archived: 0, total: 0 },
  }

  const byTenantMap = new Map<string, TenantAccum>()
  const dailyMap    = new Map<string, DailyAccum>()
  const resolveDurationsMs: number[] = []
  let oldestOpenCreatedAt: number | null = null

  for (const r of rows) {
    const life = lifecycleOf(r)
    totals.all += 1
    totals[life] += 1
    if (r.emailed_ok === false) totals.emailFailed += 1

    // By priority — fall back to user_requested if reason is somehow null/garbage.
    const reason: TicketReason = (
      r.reason === 'safety_critical' || r.reason === 'low_confidence' || r.reason === 'user_requested'
    ) ? r.reason : 'user_requested'
    byPriorityMap[reason][life] += 1
    byPriorityMap[reason].total += 1

    // By tenant.
    const key = r.tenant_id ?? '__none__'
    const tAcc = byTenantMap.get(key) ?? {
      tenantName: r.tenant_name, open: 0, resolved: 0, archived: 0, total: 0,
    }
    tAcc[life] += 1
    tAcc.total += 1
    if (!tAcc.tenantName && r.tenant_name) tAcc.tenantName = r.tenant_name
    byTenantMap.set(key, tAcc)

    // Daily opens / resolves.
    const openDay = r.created_at.slice(0, 10)
    const dOpen = dailyMap.get(openDay) ?? { opened: 0, resolved: 0 }
    dOpen.opened += 1
    dailyMap.set(openDay, dOpen)
    if (r.resolved_at) {
      const closeDay = r.resolved_at.slice(0, 10)
      const dClose = dailyMap.get(closeDay) ?? { opened: 0, resolved: 0 }
      dClose.resolved += 1
      dailyMap.set(closeDay, dClose)
    }

    // Time-to-resolve in ms (resolved or archived count; archived used
    // resolved_at as the close timestamp, never archived_at, so the
    // 30-day archival lag doesn't pollute the metric).
    if (r.resolved_at) {
      const ms = Date.parse(r.resolved_at) - Date.parse(r.created_at)
      if (Number.isFinite(ms) && ms >= 0) resolveDurationsMs.push(ms)
    }

    // Oldest still-open.
    if (life === 'open') {
      const ts = Date.parse(r.created_at)
      if (Number.isFinite(ts) && (oldestOpenCreatedAt === null || ts < oldestOpenCreatedAt)) {
        oldestOpenCreatedAt = ts
      }
    }
  }

  const byPriority = (Object.keys(byPriorityMap) as TicketReason[])
    .map(reason => ({ reason, label: PRIORITY_LABEL[reason], ...byPriorityMap[reason] }))
    .sort((a, b) => PRIORITY_ORDER[a.reason] - PRIORITY_ORDER[b.reason])

  const byTenant = Array.from(byTenantMap.entries())
    .map(([tid, v]) => ({
      tenantId:   tid === '__none__' ? null : tid,
      tenantName: v.tenantName,
      open:       v.open,
      resolved:   v.resolved,
      archived:   v.archived,
      total:      v.total,
    }))
    .sort((a, b) => b.open - a.open || b.total - a.total)

  const sortedDurations = resolveDurationsMs.slice().sort((a, b) => a - b)
  const meanMs = sortedDurations.length > 0
    ? sortedDurations.reduce((s, x) => s + x, 0) / sortedDurations.length
    : null

  const daily = Array.from(dailyMap.entries())
    .map(([day, v]) => ({ day, ...v }))
    .sort((a, b) => a.day.localeCompare(b.day))

  const oldestOpenAgeDays = oldestOpenCreatedAt === null
    ? null
    : Math.floor((now.getTime() - oldestOpenCreatedAt) / (24 * 60 * 60 * 1000))

  return {
    totals,
    byPriority,
    byTenant,
    resolutionMs: {
      count:  sortedDurations.length,
      median: quantile(sortedDurations, 0.5),
      p90:    quantile(sortedDurations, 0.9),
      mean:   meanMs,
    },
    daily,
    oldestOpenAgeDays,
  }
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 60_000)    return '<1 min'
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`
  if (ms < 86_400_000) return `${(ms / 3_600_000).toFixed(1)} h`
  return `${(ms / 86_400_000).toFixed(1)} d`
}
