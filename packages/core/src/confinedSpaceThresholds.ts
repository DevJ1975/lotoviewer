import type {
  AcceptableConditions,
  AtmosphericTest,
  ConfinedSpace,
  ConfinedSpacePermit,
} from './types'

// Numeric threshold set used everywhere a permit, space, or site default
// is resolved. Typed explicitly (not `typeof SITE_DEFAULTS`) so the fallback
// chain in effectiveThresholds() unifies — `as const` on SITE_DEFAULTS would
// pin the fields to literal types like `19.5` rather than `number`, and the
// fallbacks (which come from AcceptableConditions, where every field is
// `number | undefined`) wouldn't be assignable.
export type ThresholdSet = {
  o2_min:  number
  o2_max:  number
  lel_max: number
  h2s_max: number
  co_max:  number
}

// OSHA-default acceptable atmospheric thresholds for permit-required confined
// spaces. §1910.146 doesn't fix exact numbers but these are the universally-
// cited industry baselines and what virtually every state plan adopts.
export const SITE_DEFAULTS: ThresholdSet = {
  o2_min:  19.5,
  o2_max:  23.5,
  lel_max: 10,
  h2s_max: 10,
  co_max:  35,
}

// Resolve effective thresholds for a permit. Priority:
//   1. Permit-level override (if the supervisor changed them on this permit)
//   2. Space-level acceptable_conditions
//   3. Site defaults
// Each field is resolved independently — a partial override only changes the
// fields it specifies, the rest fall back through the chain.
export function effectiveThresholds(
  permit: Pick<ConfinedSpacePermit, 'acceptable_conditions_override'> | null,
  space: Pick<ConfinedSpace, 'acceptable_conditions'> | null,
): ThresholdSet {
  const o = permit?.acceptable_conditions_override ?? null
  const s = space?.acceptable_conditions ?? null
  return {
    o2_min:  o?.o2_min  ?? s?.o2_min  ?? SITE_DEFAULTS.o2_min,
    o2_max:  o?.o2_max  ?? s?.o2_max  ?? SITE_DEFAULTS.o2_max,
    lel_max: o?.lel_max ?? s?.lel_max ?? SITE_DEFAULTS.lel_max,
    h2s_max: o?.h2s_max ?? s?.h2s_max ?? SITE_DEFAULTS.h2s_max,
    co_max:  o?.co_max  ?? s?.co_max  ?? SITE_DEFAULTS.co_max,
  }
}

export type ReadingStatus = 'pass' | 'fail' | 'unknown'
export type ChannelKey = 'o2' | 'lel' | 'h2s' | 'co'

// Evaluate one channel of a reading against the thresholds. `unknown` means
// the channel wasn't measured — it doesn't fail the permit, but a complete
// pre-entry test should not be missing O2 / LEL.
export function evaluateChannel(
  channel: ChannelKey,
  value: number | null | undefined,
  t: ThresholdSet,
): ReadingStatus {
  if (value == null || Number.isNaN(value)) return 'unknown'
  switch (channel) {
    case 'o2':  return value >= t.o2_min && value <= t.o2_max ? 'pass' : 'fail'
    case 'lel': return value <= t.lel_max ? 'pass' : 'fail'
    case 'h2s': return value <= t.h2s_max ? 'pass' : 'fail'
    case 'co':  return value <= t.co_max  ? 'pass' : 'fail'
  }
}

// A reading is "passing" overall when no channel fails AND at least the two
// mandatory pre-entry channels (O2 and LEL per §(d)(5)(i)(A)(B)) have values.
// H2S and CO are toxics — only required when relevant to the space's hazard
// profile, but if the meter reports them, a fail still fails.
export function evaluateTest(
  test: Pick<AtmosphericTest, 'o2_pct' | 'lel_pct' | 'h2s_ppm' | 'co_ppm'>,
  t: ThresholdSet,
): { status: ReadingStatus; channels: Record<ChannelKey, ReadingStatus> } {
  const channels: Record<ChannelKey, ReadingStatus> = {
    o2:  evaluateChannel('o2',  test.o2_pct,  t),
    lel: evaluateChannel('lel', test.lel_pct, t),
    h2s: evaluateChannel('h2s', test.h2s_ppm, t),
    co:  evaluateChannel('co',  test.co_ppm,  t),
  }
  if (channels.o2 === 'fail' || channels.lel === 'fail' || channels.h2s === 'fail' || channels.co === 'fail') {
    return { status: 'fail', channels }
  }
  if (channels.o2 === 'unknown' || channels.lel === 'unknown') {
    // Missing the mandatory channels — not a fail, but not enough to authorize entry.
    return { status: 'unknown', channels }
  }
  return { status: 'pass', channels }
}

export type PermitState = 'pending_signature' | 'active' | 'expired' | 'canceled'

export function permitState(p: Pick<ConfinedSpacePermit, 'canceled_at' | 'entry_supervisor_signature_at' | 'expires_at'>): PermitState {
  if (p.canceled_at) return 'canceled'
  if (!p.entry_supervisor_signature_at) return 'pending_signature'
  // A malformed expires_at string parses to NaN, and NaN-vs-now comparisons
  // are always false — so the previous form silently classified corrupted
  // dates as 'active' and they would never expire. Treat unparseable
  // timestamps as expired (fail-closed): worst-case the supervisor cancels
  // and re-issues, vs. an "active" permit that should have ended hours ago.
  const expiresMs = new Date(p.expires_at).getTime()
  if (Number.isNaN(expiresMs))     return 'expired'
  if (expiresMs < Date.now())      return 'expired'
  return 'active'
}

// Validate AcceptableConditions shape — we accept a partial; just sanity-
// check the numeric fields are positive and o2_min < o2_max.
export function validateAcceptableConditions(c: AcceptableConditions): string | null {
  if (c.o2_min != null && c.o2_max != null && c.o2_min >= c.o2_max) {
    return 'Oxygen minimum must be less than maximum.'
  }
  for (const [k, v] of Object.entries(c) as Array<[keyof AcceptableConditions, unknown]>) {
    if (typeof v === 'number' && v < 0) return `${k} cannot be negative.`
  }
  return null
}
