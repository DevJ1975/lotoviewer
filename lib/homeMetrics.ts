import { supabase } from '@/lib/supabase'

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

export interface ActivePermitSummary {
  id:               string
  serial:           string
  spaceId:          string
  spaceDescription: string | null
  expiresAt:        string
  entrants:         string[]
  attendants:       string[]
}

export interface EquipmentPhotoStatusRow {
  photo_status: 'missing' | 'partial' | 'complete'
}

export interface HomeMetrics {
  activePermits:      ActivePermitSummary[]   // top 3 by soonest expiry
  activePermitCount:  number
  expiredPermitCount: number                  // signed, not canceled, past expires_at
  peopleInSpaces:     number                  // sum of entrants across active permits
  totalEquipment:     number
  photoCompletionPct: number                  // 0-100, integer rounded
  recentActivity:     ActivityEvent[]
}

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

// Compose the metrics object from already-fetched rows. Pure — no I/O.
// Caller does the supabase reads and hands the rows in; tests skip the
// DB entirely and just feed fixtures.
export function summarizeMetricsFromRows({
  permits, equipRows, audits, spaceDescById, nowMs,
}: {
  permits:       PermitSummaryRow[]
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

  return {
    activePermits:      top3,
    activePermitCount:  active.length,
    expiredPermitCount: expired.length,
    peopleInSpaces,
    totalEquipment:     total,
    photoCompletionPct,
    recentActivity,
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

  const [permitsRes, equipRes, auditRes] = await Promise.all([
    supabase
      .from('loto_confined_space_permits')
      .select('id, serial, space_id, expires_at, canceled_at, entry_supervisor_signature_at, entrants, attendants')
      .is('canceled_at', null)
      .not('entry_supervisor_signature_at', 'is', null)
      .order('expires_at', { ascending: true })
      .limit(50),  // generous cap; we sort + filter further client-side
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

  return summarizeMetricsFromRows({ permits, equipRows, audits, spaceDescById, nowMs })
}
