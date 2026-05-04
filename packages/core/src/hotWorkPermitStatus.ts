import type { HotWorkPermit } from './types'

// Hot Work permit lifecycle helpers. Mirrors lib/permitStatus.ts (the
// CS countdown library) but adds the post-work fire-watch phase that's
// unique to hot work. NFPA 51B §8.7 + Cal/OSHA §6777: after the work
// completes, a fire watcher must remain on site for at least 60 min
// (some sites bump to 120). The permit cannot close until that timer
// elapses — even if the supervisor would like to release the watcher.
//
// All functions are pure: no I/O, deterministic, given an `asOfMs`
// parameter so unit tests stay independent of wall-clock time.

// ── State machine ──────────────────────────────────────────────────────────
//
//   pending_signature       — created, PAI hasn't signed yet
//   active                  — signed, work in progress, before expires_at
//   expired                 — past expires_at, never signed-off as complete
//                             (or signed but neither work_completed_at nor
//                             canceled_at was set before expiry)
//   post_work_watch         — work_completed_at set, post_watch_minutes
//                             timer still running
//   post_watch_complete     — post-watch timer elapsed; ready to close
//   canceled                — canceled_at set (any reason)
//
// The state derivation is fail-closed: malformed timestamps produce
// 'expired' rather than silently classifying as active. Same posture
// as lib/confinedSpaceThresholds.ts permitState().

export type HotWorkState =
  | 'pending_signature'
  | 'active'
  | 'expired'
  | 'post_work_watch'
  | 'post_watch_complete'
  | 'canceled'

export function hotWorkState(
  p: Pick<HotWorkPermit,
    'pai_signature_at' | 'expires_at' | 'canceled_at'
    | 'work_completed_at' | 'post_watch_minutes'>,
  asOfMs: number = Date.now(),
): HotWorkState {
  if (p.canceled_at)             return 'canceled'
  if (!p.pai_signature_at)       return 'pending_signature'

  // Once work_completed_at is set, expiry is no longer meaningful —
  // we're in the post-work watch phase regardless of whether the
  // permit's expires_at has technically passed.
  if (p.work_completed_at) {
    const wcMs = new Date(p.work_completed_at).getTime()
    if (Number.isNaN(wcMs)) return 'expired'   // fail-closed
    const watchEndsMs = wcMs + p.post_watch_minutes * 60_000
    return asOfMs >= watchEndsMs ? 'post_watch_complete' : 'post_work_watch'
  }

  // No work_completed_at: signed but still actively working. Check
  // expiry against expires_at.
  const expiresMs = new Date(p.expires_at).getTime()
  if (Number.isNaN(expiresMs)) return 'expired'   // fail-closed
  if (asOfMs >= expiresMs)     return 'expired'
  return 'active'
}

// ── Countdowns ─────────────────────────────────────────────────────────────

export interface HotWorkCountdown {
  // Minutes remaining in the active phase (until expires_at). Null when
  // not in 'active' state.
  activeMinutesRemaining:    number | null
  // Minutes remaining in the post-work watch (until work_completed_at +
  // post_watch_minutes). Null when not in 'post_work_watch' state.
  postWatchMinutesRemaining: number | null
}

export function hotWorkCountdown(
  p: Pick<HotWorkPermit,
    'pai_signature_at' | 'expires_at' | 'canceled_at'
    | 'work_completed_at' | 'post_watch_minutes'>,
  asOfMs: number = Date.now(),
): HotWorkCountdown {
  const state = hotWorkState(p, asOfMs)
  if (state === 'active') {
    const expiresMs = new Date(p.expires_at).getTime()
    return {
      activeMinutesRemaining:    Math.max(0, Math.ceil((expiresMs - asOfMs) / 60_000)),
      postWatchMinutesRemaining: null,
    }
  }
  if (state === 'post_work_watch') {
    const wcMs = new Date(p.work_completed_at!).getTime()
    const watchEndsMs = wcMs + p.post_watch_minutes * 60_000
    return {
      activeMinutesRemaining:    null,
      postWatchMinutesRemaining: Math.max(0, Math.ceil((watchEndsMs - asOfMs) / 60_000)),
    }
  }
  return { activeMinutesRemaining: null, postWatchMinutesRemaining: null }
}

// ── Tone helper for visual cues ────────────────────────────────────────────
// Same shape as the CS permit tone helper so the status board / home
// alerts can use a single switch.
export type HotWorkTone = 'safe' | 'warning' | 'critical' | 'neutral'

export function hotWorkTone(
  state: HotWorkState,
  countdown: HotWorkCountdown,
): HotWorkTone {
  if (state === 'expired')             return 'critical'
  if (state === 'canceled')            return 'neutral'
  if (state === 'pending_signature')   return 'warning'
  if (state === 'post_watch_complete') return 'safe'
  if (state === 'post_work_watch') {
    // Post-watch is a holding pattern — ambient warning until done.
    const m = countdown.postWatchMinutesRemaining ?? 0
    return m <= 5 ? 'safe' : 'warning'
  }
  if (state === 'active') {
    const m = countdown.activeMinutesRemaining ?? 0
    if (m <= 30)  return 'critical'
    if (m <= 120) return 'warning'
    return 'safe'
  }
  return 'neutral'
}

// ── Sign-gate predicate ────────────────────────────────────────────────────
// Composes the hard / soft gates the detail page applies before allowing
// the PAI to sign. Returns the list of reasons sign is currently blocked;
// empty list = ready to sign. Pure so the form can re-evaluate on each
// keystroke without side-effects.
//
// Hard blocks (always):
//   • Pre-work checklist isn't fully populated (validateChecklist passes)
//   • work_types is empty
//   • work_location or work_description blank
//   • hot_work_operators is empty
//   • fire_watch_personnel is empty
//   • Any name appears in BOTH operators and watchers (Cal/OSHA §6777)
//   • If pre_work_checks.confined_space === true,
//     associated_cs_permit_id must be non-null
//
// The actual checklist validity check lives in lib/hotWorkChecklist.ts;
// we compose that here so the detail page calls one function.

export interface SignGateBlock {
  code:    string
  message: string
}

import { validateChecklist } from './hotWorkChecklist'

export function evaluateSignGates(
  p: Pick<HotWorkPermit,
    'work_location' | 'work_description' | 'work_types'
    | 'hot_work_operators' | 'fire_watch_personnel'
    | 'pre_work_checks' | 'associated_cs_permit_id'>,
): SignGateBlock[] {
  const blocks: SignGateBlock[] = []

  if (!p.work_location.trim()) {
    blocks.push({ code: 'location_blank', message: 'Work location is required.' })
  }
  if (!p.work_description.trim()) {
    blocks.push({ code: 'description_blank', message: 'Work description is required.' })
  }
  if (p.work_types.length === 0) {
    blocks.push({ code: 'work_types_empty', message: 'Pick at least one work type (welding, cutting, …).' })
  }
  if (p.hot_work_operators.length === 0) {
    blocks.push({ code: 'no_operators', message: 'At least one hot-work operator must be on the roster.' })
  }
  if (p.fire_watch_personnel.length === 0) {
    blocks.push({
      code:    'no_watcher',
      message: 'A dedicated fire watcher is required (NFPA 51B / Cal/OSHA §6777).',
    })
  }

  // Cal/OSHA §6777 — the fire watcher must NOT also be performing hot
  // work. Hard block on overlap. Case-insensitive comparison since
  // rosters are typed by hand and casing drifts.
  const operatorsLower = new Set(p.hot_work_operators.map(n => n.trim().toLowerCase()))
  const overlap = p.fire_watch_personnel.filter(n => operatorsLower.has(n.trim().toLowerCase()))
  if (overlap.length > 0) {
    blocks.push({
      code:    'watcher_operator_overlap',
      message: `Fire watcher cannot also be performing the work: ${overlap.join(', ')} (Cal/OSHA §6777).`,
    })
  }

  // Confined-space cross-link required when the pre-work checklist
  // flags confined-space context.
  if (p.pre_work_checks?.confined_space === true && !p.associated_cs_permit_id) {
    blocks.push({
      code:    'cs_link_required',
      message: 'Hot work in a confined space requires an active CS permit linked here (§1910.146(f)(15)).',
    })
  }

  // Pre-work checklist completeness (delegates to dedicated lib).
  const checklistIssues = validateChecklist(p.pre_work_checks ?? {})
  for (const issue of checklistIssues) {
    blocks.push({ code: 'checklist:' + issue.code, message: issue.message })
  }

  return blocks
}
