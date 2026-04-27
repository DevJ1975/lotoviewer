import type { TrainingRecord, TrainingRole } from '@/lib/types'

// Pure helpers for §1910.146(g) training-record compliance. Used by the
// permit-sign gate: walk the entrants[] and attendants[] rosters and
// surface anyone without a current cert. The gate is a soft-block
// (warn + require-confirm), matching the rest of the app's compliance
// pattern — supervisors own the call, the audit trail captures the
// decision, and the workflow doesn't grind to a halt over a paperwork
// gap that's been verified off-app.

export const TRAINING_ROLE_LABELS: Record<TrainingRole, string> = {
  entrant:           'Authorized entrant',
  attendant:         'Attendant',
  entry_supervisor:  'Entry supervisor',
  rescuer:           'Rescuer',
  // Hot-work roles (migration 019). hot_work_operator covers welders,
  // cutters, grinders, etc.; fire_watcher is the dedicated fire-watch
  // role required during AND for ≥60 min after hot work per NFPA 51B.
  hot_work_operator: 'Hot-work operator',
  fire_watcher:      'Fire watcher',
  other:             'Other',
}

// What roles satisfy a given roster slot. An entrant can be qualified
// by their entrant cert, but also by their entry-supervisor or rescuer
// cert (§1910.146(g)(2-4) — supervisors and rescuers are trained to a
// strictly higher standard, so a current cert in either role covers
// entrant duties on a permit).
const ROLES_FOR_SLOT: Record<'entrant' | 'attendant', TrainingRole[]> = {
  entrant:   ['entrant', 'entry_supervisor', 'rescuer'],
  attendant: ['attendant', 'entry_supervisor'],
}

export type TrainingIssueKind = 'missing' | 'expired'

export interface TrainingIssue {
  worker_name: string
  slot:        'entrant' | 'attendant'
  kind:        TrainingIssueKind
  // For 'expired' issues — the most recently expired record's date so
  // the supervisor can see how stale the cert is. Null on 'missing'.
  expired_on:  string | null
}

// Validate that every name on the permit's roster has a current training
// record covering its slot. Returns an empty array when everyone is
// covered; otherwise returns one issue per (name, slot) gap.
//
// Case-insensitive name match. asOf is a parameter so tests are
// deterministic; the live caller passes Date.now().
export function validateTraining(args: {
  entrants:    string[]
  attendants:  string[]
  records:     TrainingRecord[]
  asOf:        Date
}): TrainingIssue[] {
  const { entrants, attendants, records, asOf } = args
  const today = ymd(asOf)
  // Name → role → most recent record (by completed_at). We pick the
  // freshest cert per (name, role) so a worker with a recent renewal
  // doesn't get flagged because of an older expired record.
  const byName = new Map<string, Map<TrainingRole, TrainingRecord>>()
  for (const r of records) {
    const k = r.worker_name.toLowerCase()
    let inner = byName.get(k)
    if (!inner) { inner = new Map(); byName.set(k, inner) }
    const existing = inner.get(r.role)
    if (!existing || r.completed_at > existing.completed_at) {
      inner.set(r.role, r)
    }
  }

  const issues: TrainingIssue[] = []
  for (const name of entrants)   issues.push(...check(name, 'entrant',   byName, today))
  for (const name of attendants) issues.push(...check(name, 'attendant', byName, today))
  return issues
}

function check(
  name: string,
  slot: 'entrant' | 'attendant',
  byName: Map<string, Map<TrainingRole, TrainingRecord>>,
  today: string,
): TrainingIssue[] {
  const inner = byName.get(name.toLowerCase())
  const acceptableRoles = ROLES_FOR_SLOT[slot]
  if (!inner || acceptableRoles.every(r => !inner.has(r))) {
    return [{ worker_name: name, slot, kind: 'missing', expired_on: null }]
  }
  // At least one cert exists in an acceptable role. Pick the freshest
  // non-expired one if any; if none qualify, surface the latest expiry
  // so the supervisor sees how stale the qualification is.
  let bestExpiry: string | null = null
  for (const role of acceptableRoles) {
    const rec = inner.get(role)
    if (!rec) continue
    if (!rec.expires_at) return []                   // no expiry → covered
    if (rec.expires_at >= today) return []           // current → covered
    if (!bestExpiry || rec.expires_at > bestExpiry) bestExpiry = rec.expires_at
  }
  return [{ worker_name: name, slot, kind: 'expired', expired_on: bestExpiry }]
}

// YYYY-MM-DD in UTC. ISO date strings sort lexicographically so we
// compare via string ops — avoids Date-arithmetic edge cases at DST.
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// ── Hot Work training validation (§1910.252(a)(2)(xv) + NFPA 51B §6.5) ────
//
// Same kind/missing/expired output as validateTraining() so the hot-work
// permit-sign gate can render issues with the same UI. Different slot
// mapping:
//   - operator slot → 'hot_work_operator' role (no higher-standard
//     fallback; a fire watcher cert is for fire watching, not for
//     performing the work)
//   - watcher slot → 'fire_watcher' role
// Mirror the entry/exit-of-scope logic from validateTraining for
// consistency.
const HOT_WORK_ROLES_FOR_SLOT: Record<'operator' | 'watcher', TrainingRole[]> = {
  operator: ['hot_work_operator'],
  watcher:  ['fire_watcher'],
}

export interface HotWorkTrainingIssue {
  worker_name: string
  slot:        'operator' | 'watcher'
  kind:        TrainingIssueKind
  expired_on:  string | null
}

export function validateHotWorkTraining(args: {
  operators:  string[]
  watchers:   string[]
  records:    TrainingRecord[]
  asOf:       Date
}): HotWorkTrainingIssue[] {
  const { operators, watchers, records, asOf } = args
  const today = ymd(asOf)
  const byName = new Map<string, Map<TrainingRole, TrainingRecord>>()
  for (const r of records) {
    const k = r.worker_name.toLowerCase()
    let inner = byName.get(k)
    if (!inner) { inner = new Map(); byName.set(k, inner) }
    const existing = inner.get(r.role)
    if (!existing || r.completed_at > existing.completed_at) {
      inner.set(r.role, r)
    }
  }

  const issues: HotWorkTrainingIssue[] = []
  for (const name of operators) issues.push(...checkHotWork(name, 'operator', byName, today))
  for (const name of watchers)  issues.push(...checkHotWork(name, 'watcher',  byName, today))
  return issues
}

function checkHotWork(
  name: string,
  slot: 'operator' | 'watcher',
  byName: Map<string, Map<TrainingRole, TrainingRecord>>,
  today: string,
): HotWorkTrainingIssue[] {
  const inner = byName.get(name.toLowerCase())
  const acceptableRoles = HOT_WORK_ROLES_FOR_SLOT[slot]
  if (!inner || acceptableRoles.every(r => !inner.has(r))) {
    return [{ worker_name: name, slot, kind: 'missing', expired_on: null }]
  }
  let bestExpiry: string | null = null
  for (const role of acceptableRoles) {
    const rec = inner.get(role)
    if (!rec) continue
    if (!rec.expires_at) return []
    if (rec.expires_at >= today) return []
    if (!bestExpiry || rec.expires_at > bestExpiry) bestExpiry = rec.expires_at
  }
  return [{ worker_name: name, slot, kind: 'expired', expired_on: bestExpiry }]
}
