import { supabase } from '@/lib/supabase'
import { hotWorkState } from '@/lib/hotWorkPermitStatus'

// Aggregator for the home screen at /. Splits the work into a pure
// summarizer + a thin DB orchestrator so the logic (audit-event prose,
// active-permit filtering, compliance %) is unit-testable without
// mocking supabase.

// ── Types ──────────────────────────────────────────────────────────────────

export type AuditOperation = 'INSERT' | 'UPDATE' | 'DELETE'

export interface AuditLogRow {
  id:           number
  actor_id?:    string | null
  actor_email?: string | null
  table_name:   string
  operation:    AuditOperation
  row_pk:       string | null
  old_row:      Record<string, unknown> | null
  new_row:      Record<string, unknown> | null
  created_at:   string
}

export interface ActivityEvent {
  id:          number
  at:          string                    // ISO timestamp
  actorEmail:  string | null
  description: string                    // human-readable, e.g. "Permit signed"
  link:        string | null             // best-effort deep link, or null
}

export interface PermitSummaryRow {
  id:                              string
  serial:                          string | null
  space_id:                        string
  expires_at:                      string
  canceled_at:                     string | null
  entry_supervisor_signature_at:   string | null
  entrants:                        string[]
  attendants:                      string[]
}

// Lean shape for the pending-signature feed — drafts the supervisor created
// but never signed. We only need started_at to age them; the rest is for
// link rendering on the home alerts card.
export interface PendingPermitRow {
  id:                              string
  serial:                          string | null
  space_id:                        string
  started_at:                      string
  canceled_at:                     string | null
  entry_supervisor_signature_at:   string | null
}

export interface ActivePermitSummary {
  id:               string
  serial:           string
  spaceId:          string
  spaceDescription: string | null
  expiresAt:        string
  entrants:         string[]
  attendants:       string[]
}

// Compact shape for the home "alerts" card — same fields whether the
// alert is "expiring soon" or "pending too long," with `minutesUntilDue`
// being negative on overdue. Keeps the home rendering uniform.
export interface PermitAlertSummary {
  id:               string
  serial:           string
  spaceId:          string
  // For expiring-soon: minutes until expires_at. For pending-stale:
  // minutes since started_at (always positive — the pending alert fires
  // when this exceeds the threshold).
  minutes:          number
}

export interface EquipmentPhotoStatusRow {
  photo_status: 'missing' | 'partial' | 'complete'
}

// Lean shape for the hot-work alert feed. Mirrors PermitSummaryRow but
// scoped to the fields hotWorkState() needs to derive lifecycle state.
export interface HotWorkPermitRow {
  id:                    string
  serial:                string | null
  work_location:         string
  pai_signature_at:      string | null
  expires_at:            string
  canceled_at:           string | null
  work_completed_at:     string | null
  post_watch_minutes:    number
}

// Hot-work alert summary. `kind` discriminates what timer the `minutes`
// field refers to so the home card can render context-appropriate copy
// ("expires in 12 min" vs "fire watch ends in 35 min").
export interface HotWorkAlertSummary {
  id:           string
  serial:       string
  workLocation: string
  kind:         'expiring' | 'post_watch'
  minutes:      number
}

export interface HomeMetrics {
  activePermits:        ActivePermitSummary[]   // top 3 by soonest expiry
  activePermitCount:    number
  expiredPermitCount:   number                  // signed, not canceled, past expires_at
  peopleInSpaces:       number                  // sum of entrants across active permits
  totalEquipment:       number
  photoCompletionPct:   number                  // 0-100, integer rounded
  recentActivity:       ActivityEvent[]
  // Active permits with < EXPIRING_SOON_MIN remaining. Empty when none.
  expiringSoonPermits:  PermitAlertSummary[]
  // Pending-signature permits older than PENDING_STALE_MIN — drafts the
  // supervisor opened and walked away from. Empty when none.
  pendingStalePermits:  PermitAlertSummary[]
  // Active hot-work permits with < HOT_WORK_EXPIRING_SOON_MIN remaining.
  // Tighter than the CS threshold because fire-watcher attention matters
  // most near end-of-period.
  hotWorkExpiringSoon:  HotWorkAlertSummary[]
  // Hot-work permits currently in the post-work fire-watch phase. Not an
  // urgency alert — informational so the supervisor can see who's still
  // on watch and shouldn't be released.
  hotWorkInPostWatch:   HotWorkAlertSummary[]
}

// Thresholds for the home alerts card. Surfaced as exported constants so
// tests and UI label strings stay in sync ("Expiring in <2h", etc.).
export const EXPIRING_SOON_MIN          = 120  // < 2 hours remaining triggers the alert
export const PENDING_STALE_MIN          = 120  // pending > 2 hours triggers the alert
export const HOT_WORK_EXPIRING_SOON_MIN = 30   // hot work is shorter-lived; tighter threshold

// ── Pure helpers (testable without supabase) ──────────────────────────────

// Translate an audit_log row into a human-readable activity line. Falls
// back to a generic "<op> on <table>" if no specific case matches; that
// way new tables produce something readable without a code change.
export function describeAuditEvent(row: AuditLogRow): string {
  const op   = row.operation
  const oldR = row.old_row
  const newR = row.new_row

  switch (row.table_name) {
    case 'loto_confined_space_permits':
      if (op === 'INSERT') return 'Permit issued'
      if (op === 'DELETE') return 'Permit removed'
      if (op === 'UPDATE') {
        const wasCanceled = oldR?.canceled_at != null
        const isCanceled  = newR?.canceled_at != null
        if (isCanceled && !wasCanceled) {
          const reason = (newR?.cancel_reason as string | undefined) ?? null
          return reason ? `Permit canceled (${reason.replace(/_/g, ' ')})` : 'Permit canceled'
        }
        const wasSigned = oldR?.entry_supervisor_signature_at != null
        const isSigned  = newR?.entry_supervisor_signature_at != null
        if (isSigned && !wasSigned) return 'Permit signed — entry authorized'
        return 'Permit updated'
      }
      break

    case 'loto_atmospheric_tests':
      // Audit log only fires on insert here (tests aren't edited); fall
      // through to the generic line anyway for forward-compat.
      if (op === 'INSERT') return 'Atmospheric test recorded'
      break

    case 'loto_confined_spaces':
      if (op === 'INSERT') return 'Confined space added'
      if (op === 'UPDATE') return 'Confined space edited'
      if (op === 'DELETE') return 'Confined space removed'
      break

    case 'loto_equipment':
      if (op === 'INSERT') return 'Equipment added'
      if (op === 'DELETE') return 'Equipment removed'
      if (op === 'UPDATE') {
        // Differentiate photo saves from generic edits — the most common
        // update on this table is a photo URL flipping from null to a URL.
        const equipChanged = (oldR?.equip_photo_url ?? null) !== (newR?.equip_photo_url ?? null)
        const isoChanged   = (oldR?.iso_photo_url   ?? null) !== (newR?.iso_photo_url   ?? null)
        if (equipChanged || isoChanged) return 'Equipment photo saved'
        return 'Equipment edited'
      }
      break

    case 'loto_energy_steps':
      if (op === 'INSERT') return 'Energy step added'
      if (op === 'UPDATE') return 'Energy step edited'
      if (op === 'DELETE') return 'Energy step removed'
      break

    case 'profiles':
      return 'User profile updated'

    case 'loto_reviews':
      return 'Department review recorded'
  }

  // Generic fallback — drops the loto_ prefix for readability.
  const tbl = row.table_name.replace(/^loto_/, '').replace(/_/g, ' ')
  return `${op.toLowerCase()} on ${tbl}`
}

// Best-effort deep link for an audit event. Null when we don't have
// enough info — the activity row stays informational but isn't clickable.
export function linkForAuditEvent(row: AuditLogRow): string | null {
  const next = row.new_row
  const old  = row.old_row

  switch (row.table_name) {
    case 'loto_confined_space_permits': {
      const spaceId = (next?.space_id ?? old?.space_id) as string | undefined
      const id = row.row_pk
      if (spaceId && id) {
        return `/confined-spaces/${encodeURIComponent(spaceId)}/permits/${id}`
      }
      return '/confined-spaces'
    }
    case 'loto_atmospheric_tests': {
      const permitId = (next?.permit_id ?? old?.permit_id) as string | undefined
      // We don't have space_id here; fall back to the status board which
      // surfaces all active permits anyway.
      if (permitId) return '/confined-spaces/status'
      return '/confined-spaces'
    }
    case 'loto_confined_spaces': {
      const id = row.row_pk
      if (id) return `/confined-spaces/${encodeURIComponent(id)}`
      return '/confined-spaces'
    }
    case 'loto_equipment': {
      const id = row.row_pk
      if (id) return `/equipment/${encodeURIComponent(id)}`
      return '/loto'
    }
    case 'loto_energy_steps': {
      const eqId = (next?.equipment_id ?? old?.equipment_id) as string | undefined
      if (eqId) return `/equipment/${encodeURIComponent(eqId)}`
      return '/loto'
    }
    default:
      return null
  }
}

// Filter signed-not-canceled permits into "active" (still has time) and
// "expired" (past expires_at, not yet formally canceled per §(e)(5)).
// nowMs is a parameter so tests are deterministic.
export function partitionPermits(permits: PermitSummaryRow[], nowMs: number): {
  active:  PermitSummaryRow[]
  expired: PermitSummaryRow[]
} {
  const active:  PermitSummaryRow[] = []
  const expired: PermitSummaryRow[] = []
  for (const p of permits) {
    if (p.canceled_at) continue                              // already cancelled — skip
    if (!p.entry_supervisor_signature_at) continue           // unsigned drafts — skip
    const expiresMs = new Date(p.expires_at).getTime()
    if (Number.isNaN(expiresMs) || expiresMs <= nowMs) {
      expired.push(p)
    } else {
      active.push(p)
    }
  }
  return { active, expired }
}

// Active permits whose expires_at is within `thresholdMin` of nowMs. Driven
// by elapsed minutes, not absolute timestamps, so the home stays accurate
// across DST transitions. Sorted by minutes-remaining ascending — the most
// urgent first.
export function findExpiringSoon(
  active: PermitSummaryRow[],
  nowMs: number,
  thresholdMin: number,
): PermitAlertSummary[] {
  const out: PermitAlertSummary[] = []
  for (const p of active) {
    const expMs = new Date(p.expires_at).getTime()
    if (Number.isNaN(expMs)) continue
    const minutes = (expMs - nowMs) / 60_000
    if (minutes <= 0 || minutes > thresholdMin) continue
    out.push({
      id:      p.id,
      serial:  p.serial ?? `permit-${p.id.slice(0, 8)}`,
      spaceId: p.space_id,
      minutes: Math.round(minutes),
    })
  }
  return out.sort((a, b) => a.minutes - b.minutes)
}

// Pending-signature permits older than `thresholdMin`. Filters out anything
// already signed or canceled defensively even though the caller's query
// should be doing that already.
export function findPendingStale(
  pending: PendingPermitRow[],
  nowMs: number,
  thresholdMin: number,
): PermitAlertSummary[] {
  const out: PermitAlertSummary[] = []
  for (const p of pending) {
    if (p.canceled_at) continue
    if (p.entry_supervisor_signature_at) continue
    const startedMs = new Date(p.started_at).getTime()
    if (Number.isNaN(startedMs)) continue
    const minutes = (nowMs - startedMs) / 60_000
    if (minutes < thresholdMin) continue
    out.push({
      id:      p.id,
      serial:  p.serial ?? `permit-${p.id.slice(0, 8)}`,
      spaceId: p.space_id,
      minutes: Math.round(minutes),
    })
  }
  // Oldest stale draft first — that's the most likely to be abandoned.
  return out.sort((a, b) => b.minutes - a.minutes)
}

// Active hot-work permits whose expires_at is within `thresholdMin` of
// nowMs. Filters via hotWorkState() so canceled / pending / post-watch
// rows are skipped. Sorted soonest-first.
export function findHotWorkExpiring(
  rows:         HotWorkPermitRow[],
  nowMs:        number,
  thresholdMin: number,
): HotWorkAlertSummary[] {
  const out: HotWorkAlertSummary[] = []
  for (const r of rows) {
    if (hotWorkState(r, nowMs) !== 'active') continue
    const expMs = new Date(r.expires_at).getTime()
    if (Number.isNaN(expMs)) continue
    const minutes = (expMs - nowMs) / 60_000
    if (minutes <= 0 || minutes > thresholdMin) continue
    out.push({
      id:           r.id,
      serial:       r.serial ?? `permit-${r.id.slice(0, 8)}`,
      workLocation: r.work_location,
      kind:         'expiring',
      minutes:      Math.round(minutes),
    })
  }
  return out.sort((a, b) => a.minutes - b.minutes)
}

// Hot-work permits currently in the post-work fire-watch phase. Reports
// minutes remaining on each watch so the home card can show "fire watch
// ends in 23 min." Sorted shortest-remaining first (the watcher closest
// to release goes on top).
export function findHotWorkInPostWatch(
  rows:  HotWorkPermitRow[],
  nowMs: number,
): HotWorkAlertSummary[] {
  const out: HotWorkAlertSummary[] = []
  for (const r of rows) {
    if (hotWorkState(r, nowMs) !== 'post_work_watch') continue
    const wcMs = new Date(r.work_completed_at!).getTime()
    if (Number.isNaN(wcMs)) continue
    const watchEndsMs = wcMs + r.post_watch_minutes * 60_000
    const minutes = Math.max(0, Math.ceil((watchEndsMs - nowMs) / 60_000))
    out.push({
      id:           r.id,
      serial:       r.serial ?? `permit-${r.id.slice(0, 8)}`,
      workLocation: r.work_location,
      kind:         'post_watch',
      minutes,
    })
  }
  return out.sort((a, b) => a.minutes - b.minutes)
}

// Compose the metrics object from already-fetched rows. Pure — no I/O.
// Caller does the supabase reads and hands the rows in; tests skip the
// DB entirely and just feed fixtures.
export function summarizeMetricsFromRows({
  permits, pending = [], hotWork = [], equipRows, audits, spaceDescById, nowMs,
}: {
  permits:       PermitSummaryRow[]
  // Optional so callers / fixtures that don't care about the pending-stale
  // alert (the original test suite, for example) don't have to thread it
  // through. Defaults to an empty array — no pending alerts.
  pending?:      PendingPermitRow[]
  // Optional for the same reason — fixtures that don't exercise hot-work
  // alerts can omit. Defaults to no alerts.
  hotWork?:      HotWorkPermitRow[]
  equipRows:    EquipmentPhotoStatusRow[]
  audits:       AuditLogRow[]
  spaceDescById: Map<string, string>
  nowMs:        number
}): HomeMetrics {
  const { active, expired } = partitionPermits(permits, nowMs)

  // Top-3 most-urgent active permits (already sorted ASC by caller's
  // ORDER BY expires_at, but we re-sort here defensively for fixture-
  // driven tests).
  const top3 = [...active]
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
    .slice(0, 3)
    .map((p): ActivePermitSummary => ({
      id:               p.id,
      serial:           p.serial ?? `permit-${p.id.slice(0, 8)}`,
      spaceId:          p.space_id,
      spaceDescription: spaceDescById.get(p.space_id) ?? null,
      expiresAt:        p.expires_at,
      entrants:         p.entrants,
      attendants:       p.attendants,
    }))

  const peopleInSpaces = active.reduce((sum, p) => sum + p.entrants.length, 0)

  // Compliance % — share of non-decommissioned equipment with photo_status
  // = 'complete'. Rounded to nearest integer for a clean home display.
  const total = equipRows.length
  const complete = equipRows.filter(r => r.photo_status === 'complete').length
  const photoCompletionPct = total === 0 ? 0 : Math.round((complete / total) * 100)

  const recentActivity: ActivityEvent[] = audits.map(a => ({
    id:          a.id,
    at:          a.created_at,
    actorEmail:  a.actor_email ?? null,
    description: describeAuditEvent(a),
    link:        linkForAuditEvent(a),
  }))

  const expiringSoonPermits = findExpiringSoon(active, nowMs, EXPIRING_SOON_MIN)
  const pendingStalePermits = findPendingStale(pending, nowMs, PENDING_STALE_MIN)
  const hotWorkExpiringSoon = findHotWorkExpiring(hotWork, nowMs, HOT_WORK_EXPIRING_SOON_MIN)
  const hotWorkInPostWatch  = findHotWorkInPostWatch(hotWork, nowMs)

  return {
    activePermits:        top3,
    activePermitCount:    active.length,
    expiredPermitCount:   expired.length,
    peopleInSpaces,
    totalEquipment:       total,
    photoCompletionPct,
    recentActivity,
    expiringSoonPermits,
    pendingStalePermits,
    hotWorkExpiringSoon,
    hotWorkInPostWatch,
  }
}

// ── DB orchestration ───────────────────────────────────────────────────────
//
// Three parallel reads + one follow-up to grab space descriptions for the
// top-3 permits. The follow-up is small (≤3 rows) and could be inlined
// via a foreign-key join, but Supabase's join syntax is a bit awkward for
// optional descriptions and the round-trip is sub-50ms in practice.

export async function fetchHomeMetrics(): Promise<HomeMetrics> {
  const nowMs = Date.now()

  const [permitsRes, pendingRes, hotWorkRes, equipRes, auditRes] = await Promise.all([
    supabase
      .from('loto_confined_space_permits')
      .select('id, serial, space_id, expires_at, canceled_at, entry_supervisor_signature_at, entrants, attendants')
      .is('canceled_at', null)
      .not('entry_supervisor_signature_at', 'is', null)
      .order('expires_at', { ascending: true })
      .limit(50),  // generous cap; we sort + filter further client-side
    supabase
      .from('loto_confined_space_permits')
      .select('id, serial, space_id, started_at, canceled_at, entry_supervisor_signature_at')
      .is('canceled_at', null)
      .is('entry_supervisor_signature_at', null)
      .order('started_at', { ascending: true })
      .limit(50),
    // Hot-work permits — signed + non-canceled. The pure helpers filter
    // further on state (active vs post_work_watch) so we don't need to
    // shape the query around it.
    supabase
      .from('loto_hot_work_permits')
      .select('id, serial, work_location, pai_signature_at, expires_at, canceled_at, work_completed_at, post_watch_minutes')
      .is('canceled_at', null)
      .not('pai_signature_at', 'is', null)
      .order('expires_at', { ascending: true })
      .limit(50),
    supabase
      .from('loto_equipment')
      .select('photo_status')
      .eq('decommissioned', false),
    supabase
      .from('audit_log')
      .select('id, actor_email, table_name, operation, row_pk, old_row, new_row, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  const permits   = (permitsRes.data ?? []) as PermitSummaryRow[]
  const pending   = (pendingRes.data ?? []) as PendingPermitRow[]
  const hotWork   = (hotWorkRes.data ?? []) as HotWorkPermitRow[]
  const equipRows = (equipRes.data   ?? []) as EquipmentPhotoStatusRow[]
  const audits    = (auditRes.data   ?? []) as AuditLogRow[]

  // Fetch space descriptions for the top-3 active permits' spaces. We need
  // active to know which space_ids matter; partition first, slice 3, then
  // fetch. Done as a second roundtrip rather than inlined into the first
  // query so the active-permit shape stays the same as the audit/equip
  // calls (no joins, easier to mock).
  const top3SpaceIds = partitionPermits(permits, nowMs).active
    .sort((a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime())
    .slice(0, 3)
    .map(p => p.space_id)

  const spaceDescById = new Map<string, string>()
  if (top3SpaceIds.length > 0) {
    const { data } = await supabase
      .from('loto_confined_spaces')
      .select('space_id, description')
      .in('space_id', top3SpaceIds)
    for (const s of (data ?? []) as { space_id: string; description: string }[]) {
      spaceDescById.set(s.space_id, s.description)
    }
  }

  return summarizeMetricsFromRows({ permits, pending, hotWork, equipRows, audits, spaceDescById, nowMs })
}
