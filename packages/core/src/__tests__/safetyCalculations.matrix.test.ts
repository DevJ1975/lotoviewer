// Combinatorial matrices for the calculations where a wrong number is a hazard.
//
// These sweep the full cross-product of the inputs each function branches on
// and assert SAFETY INVARIANTS — statements of what the calculation must never
// do — rather than a table of expected outputs. An expected-output table for
// thousands of rows is either generated from a copy of the implementation
// (circular, and blind to any bug both copies share) or unmaintainable; the
// invariants below stay meaningful when the numbers are retuned.
//
// The invariants are chosen by consequence. "Never under-state required fall
// clearance" is here because under-stating it puts a worker on the ground.
// "Never report a hazardous atmosphere as passing" is here because entry
// decisions are made from that verdict.
//
// Violations accumulate and are asserted as a set, so a shifted boundary
// reports every affected combination instead of only the first.

import { describe, it, expect } from 'vitest'
import {
  calculateRequiredClearance,
  requiredAnchorCapacity,
  SINGLE_WORKER_ANCHOR_MIN_LBF,
  type ClearanceInputs,
} from '../workingAtHeights'
import {
  effectiveThresholds,
  evaluateChannel,
  evaluateTest,
  permitState,
  SITE_DEFAULTS,
  type ThresholdSet,
} from '../confinedSpaceThresholds'

let EXECUTED_CASES = 0
const countCase = () => { EXECUTED_CASES += 1 }

function cross<T extends readonly unknown[][]>(...lists: T): unknown[][] {
  return lists.reduce<unknown[][]>(
    (acc, list) => acc.flatMap(row => list.map(v => [...row, v])),
    [[]],
  )
}

// ───────────────────────────────────────────────────────────────────────────
// 1. Fall-clearance — the number a worker's life depends on.
//
// Callers decide with `availableFt >= requiredClearanceFt`, so ANY
// under-statement is a false "safe to proceed".
// ───────────────────────────────────────────────────────────────────────────

const SYSTEMS = ['shock_lanyard', 'srl_class1', 'srl_class2', 'restraint'] as const
// Deliberately includes values no physical setup can produce. The type is
// `number`, so nothing stops them arriving, and the question this matrix asks
// is what the function does when they do.
const LENGTHS:  Array<number | undefined> = [undefined, 0, 0.5, 2, 6, 8, 20, -0.1, -6, NaN, Infinity, -Infinity]
const WORKERS:  Array<number | undefined> = [undefined, 0, 3, 5, 7, 12, -5, NaN]
const MARGINS:  Array<number | undefined> = [undefined, 0, 2, 5, -2, NaN]
const OFFSETS:  Array<number | undefined> = [undefined, 0, 2, 10, -4, NaN]

describe('fall clearance — full input matrix', () => {
  it('never returns a requirement that is negative, non-finite, or below the safety floor', () => {
    const violations: string[] = []

    for (const [system, len, worker, margin, offset] of cross(
      SYSTEMS, LENGTHS, WORKERS, MARGINS, OFFSETS,
    ) as Array<[typeof SYSTEMS[number], number | undefined, number | undefined, number | undefined, number | undefined]>) {
      countCase()
      const inputs: ClearanceInputs = {
        system,
        lanyardLengthFt:    len,
        workerBelowDringFt: worker,
        safetyMarginFt:     margin,
        swingFallOffsetFt:  offset,
      }
      const id = `system=${system} len=${len} worker=${worker} margin=${margin} offset=${offset}`
      const r = calculateRequiredClearance(inputs)
      const req = r.requiredClearanceFt

      // A non-finite requirement cannot be compared against available
      // clearance, so it cannot be acted on.
      if (!Number.isFinite(req)) { violations.push(`${id}: requirement ${req} is not a finite number`); continue }

      // THE invariant: `availableFt >= requiredClearanceFt` is how callers
      // decide. A requirement at or below zero makes that test vacuous — every
      // location on site, including one with no clearance at all, reads safe.
      if (req <= 0) violations.push(`${id}: requirement ${req} ft — zero clearance would read as safe`)

      // The breakdown is shown to the operator as the arithmetic behind the
      // number. If it disagrees with the total, one of the two is lying.
      const sum = r.breakdown.reduce((s, b) => s + b.feet, 0)
      if (!Number.isFinite(sum) || Math.abs(sum - req) > 0.011) {
        violations.push(`${id}: breakdown sums to ${sum} but requirement is ${req}`)
      }
      if (r.breakdown.some(b => !Number.isFinite(b.feet) || b.feet < 0)) {
        violations.push(`${id}: breakdown contains a negative or non-finite component`)
      }

      // An arrest system must always need more room than pure restraint, which
      // never generates arrest forces at all.
      if (system !== 'restraint' && req < 5) {
        violations.push(`${id}: ${req} ft is implausibly low for an arrest system`)
      }
    }

    expect(violations).toEqual([])
  })

  it('is monotonic — a longer fall never needs less room', () => {
    // Every one of these inputs can only ADD distance. If increasing one ever
    // decreases the requirement, the model is inverted somewhere.
    const violations: string[] = []
    const ladder = [0.5, 2, 4, 6, 8, 12, 20]

    for (const [system, worker, margin] of cross(
      ['shock_lanyard', 'srl_class1'], [3, 5, 7], [0, 2, 5],
    ) as Array<[typeof SYSTEMS[number], number, number]>) {
      let previous = -Infinity
      for (const len of ladder) {
        countCase()
        const req = calculateRequiredClearance({
          system, lanyardLengthFt: len, workerBelowDringFt: worker, safetyMarginFt: margin,
        }).requiredClearanceFt
        if (req < previous) {
          violations.push(`system=${system} worker=${worker} margin=${margin}: lanyard ${len}ft needs ${req}ft, less than the shorter lanyard's ${previous}ft`)
        }
        previous = req
      }
    }

    // Same for the worker's own height below the D-ring, and the margin.
    //
    // The ladders differ at zero on purpose. Zero margin is a real choice a
    // supervisor can make, so it belongs on the margin ladder. Zero height
    // below the D-ring is not a shorter worker — it is a missing measurement,
    // and the function substitutes the conservative default — so starting the
    // worker ladder at zero would compare a default against a real value and
    // read the step as a decrease.
    const LADDERS: Array<[('workerBelowDringFt' | 'safetyMarginFt'), number[]]> = [
      ['workerBelowDringFt', [1, 2, 3, 5, 7, 10]],
      ['safetyMarginFt',     [0, 1, 2, 3, 5, 7, 10]],
    ]
    for (const [dim, ladderValues] of LADDERS) {
      let previous = -Infinity
      for (const v of ladderValues) {
        countCase()
        const req = calculateRequiredClearance({
          system: 'shock_lanyard', lanyardLengthFt: 6, [dim]: v,
        }).requiredClearanceFt
        if (req < previous) violations.push(`${dim}=${v} needs ${req}ft, less than the smaller value's ${previous}ft`)
        previous = req
      }
    }

    // And swing-fall offset, which only ever adds an arc drop.
    let previousSwing = -Infinity
    for (const offset of [0, 1, 2, 4, 8, 16]) {
      countCase()
      const req = calculateRequiredClearance({
        system: 'shock_lanyard', lanyardLengthFt: 6, swingFallOffsetFt: offset,
      }).requiredClearanceFt
      if (req < previousSwing) violations.push(`swing offset ${offset}ft needs ${req}ft, less than the smaller offset's ${previousSwing}ft`)
      previousSwing = req
    }

    expect(violations).toEqual([])
  })

  it('treats an impossible distance as unmeasured, never as a reduction', () => {
    // A negative or non-finite length is not a shorter distance — it is not a
    // distance. The conservative default must be used instead, so the answer
    // matches the one given when the field was simply left blank.
    const baseline = calculateRequiredClearance({ system: 'shock_lanyard' }).requiredClearanceFt
    for (const bad of [-0.1, -6, -1000, NaN, Infinity, -Infinity]) {
      countCase()
      const r = calculateRequiredClearance({
        system: 'shock_lanyard', lanyardLengthFt: bad, workerBelowDringFt: bad, safetyMarginFt: bad,
      })
      expect(r.requiredClearanceFt, `lanyard/worker/margin all ${bad}`).toBe(baseline)
    }
  })

  it('never rates an anchor below the regulatory minimum for the workers on it', () => {
    const violations: string[] = []
    for (const [workers, engineered, paf] of cross(
      [1, 2, 3, 5, 10], [false, true], [900, 1800, 2700],
    ) as Array<[number, boolean, number]>) {
      countCase()
      const lbf = requiredAnchorCapacity(workers, engineered, paf)
      // 1910.140(c)(13): 5,000 lbf per worker, or an engineered anchor at a
      // 2:1 factor. Either way the number must scale with the headcount and
      // never fall below the non-engineered floor per worker.
      if (!engineered && lbf !== SINGLE_WORKER_ANCHOR_MIN_LBF * workers) {
        violations.push(`workers=${workers} non-engineered: got ${lbf}`)
      }
      if (lbf <= 0) violations.push(`workers=${workers} engineered=${engineered} paf=${paf}: ${lbf} lbf`)
    }
    expect(violations).toEqual([])
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. Confined-space atmosphere — the verdict an entry decision is made from.
// ───────────────────────────────────────────────────────────────────────────

describe('confined space atmosphere — full reading matrix', () => {
  // Values chosen around the OSHA-cited limits: below, exactly at, and above.
  const O2  = [null, undefined, NaN, 0, 15, 19.4, 19.5, 19.6, 20.9, 23.4, 23.5, 23.6, 30, 100]
  const LEL = [null, undefined, NaN, 0, 5, 9.9, 10, 10.1, 50, 100]
  const H2S = [null, undefined, NaN, 0, 9.9, 10, 10.1, 100]
  const CO  = [null, undefined, NaN, 0, 34.9, 35, 35.1, 1200]

  it('never reports a reading outside the limits as passing', () => {
    const violations: string[] = []
    const t = SITE_DEFAULTS

    for (const [o2, lel, h2s, co] of cross(O2, LEL, H2S, CO) as Array<[number | null | undefined, number | null | undefined, number | null | undefined, number | null | undefined]>) {
      countCase()
      const { status, channels } = evaluateTest(
        { o2_pct: o2 as number, lel_pct: lel as number, h2s_ppm: h2s as number, co_ppm: co as number },
        t,
      )
      const id = `o2=${o2} lel=${lel} h2s=${h2s} co=${co}`

      // Ground truth from the regulation, independent of the implementation.
      const outOfRange = (v: unknown, lo: number, hi: number) =>
        typeof v === 'number' && !Number.isNaN(v) && (v < lo || v > hi)
      const anyHazardous =
        outOfRange(o2, t.o2_min, t.o2_max) ||
        outOfRange(lel, -Infinity, t.lel_max) ||
        outOfRange(h2s, -Infinity, t.h2s_max) ||
        outOfRange(co, -Infinity, t.co_max)

      if (anyHazardous && status === 'pass') {
        violations.push(`${id}: HAZARDOUS atmosphere reported as pass`)
      }
      // O2 and LEL are the mandatory pre-entry channels (§(d)(5)(i)(A)(B)).
      // A test missing either cannot authorise entry, so it must not pass.
      const mandatoryMissing =
        o2 == null || Number.isNaN(o2 as number) || lel == null || Number.isNaN(lel as number)
      if (mandatoryMissing && status === 'pass') {
        violations.push(`${id}: passed without both mandatory channels`)
      }
      if (!['pass', 'fail', 'unknown'].includes(status)) {
        violations.push(`${id}: unknown status ${status}`)
      }
      // A failing channel must be visible in the breakdown, not just the roll-up.
      if (status === 'fail' && !Object.values(channels).includes('fail')) {
        violations.push(`${id}: overall fail with no failing channel`)
      }
    }

    expect(violations).toEqual([])
  })

  it('holds each channel boundary exactly where the regulation puts it', () => {
    const t = SITE_DEFAULTS
    const cases: Array<[Parameters<typeof evaluateChannel>[0], number, string]> = [
      // O2 is a band — both ends matter.
      ['o2', 19.4, 'fail'], ['o2', 19.5, 'pass'], ['o2', 20.9, 'pass'],
      ['o2', 23.5, 'pass'], ['o2', 23.6, 'fail'],
      // The rest are ceilings; the limit value itself is still acceptable.
      ['lel', 9.9, 'pass'], ['lel', 10, 'pass'], ['lel', 10.1, 'fail'],
      ['h2s', 10, 'pass'], ['h2s', 10.1, 'fail'],
      ['co', 35, 'pass'], ['co', 35.1, 'fail'],
    ]
    for (const [channel, value, expected] of cases) {
      countCase()
      expect(evaluateChannel(channel, value, t), `${channel}=${value}`).toBe(expected)
    }
  })

  it('resolves overrides field by field without inventing an impossible band', () => {
    const violations: string[] = []
    const PARTIALS = [
      null, {}, { o2_min: 20 }, { o2_max: 22 }, { lel_max: 5 },
      { o2_min: 20, o2_max: 22 }, { h2s_max: 1, co_max: 25 },
    ]
    for (const [override, spaceLevel] of cross(PARTIALS, PARTIALS) as Array<[Record<string, number> | null, Record<string, number> | null]>) {
      countCase()
      const t: ThresholdSet = effectiveThresholds(
        override ? { acceptable_conditions_override: override } as never : null,
        spaceLevel ? { acceptable_conditions: spaceLevel } as never : null,
      )
      const id = `override=${JSON.stringify(override)} space=${JSON.stringify(spaceLevel)}`

      // Every field must resolve to a usable number — a missing one would make
      // the comparison against it meaningless.
      for (const [k, v] of Object.entries(t)) {
        if (typeof v !== 'number' || !Number.isFinite(v)) violations.push(`${id}: ${k} resolved to ${v}`)
      }
      // Precedence: permit override, then space, then site default.
      const expect_ = (field: keyof ThresholdSet) =>
        (override?.[field] ?? spaceLevel?.[field] ?? SITE_DEFAULTS[field])
      for (const field of ['o2_min', 'o2_max', 'lel_max', 'h2s_max', 'co_max'] as const) {
        if (t[field] !== expect_(field)) {
          violations.push(`${id}: ${field} resolved to ${t[field]}, expected ${expect_(field)}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('never leaves a permit active on an unreadable or past expiry', () => {
    const violations: string[] = []
    const SIGNED    = [null, '2026-08-01T00:00:00Z']
    const CANCELLED = [null, '2026-08-02T00:00:00Z']
    const EXPIRES   = [
      new Date(Date.now() + 3_600_000).toISOString(),   // an hour out
      new Date(Date.now() - 3_600_000).toISOString(),   // an hour ago
      'not-a-date', '', '0000-00-00', 'null',
    ]
    for (const [signed, cancelled, expires] of cross(SIGNED, CANCELLED, EXPIRES) as Array<[string | null, string | null, string]>) {
      countCase()
      const state = permitState({
        canceled_at: cancelled, entry_supervisor_signature_at: signed, expires_at: expires,
      } as never)
      const id = `signed=${!!signed} cancelled=${!!cancelled} expires=${expires}`

      if (cancelled && state !== 'canceled') violations.push(`${id}: cancelled permit is ${state}`)
      if (!cancelled && !signed && state !== 'pending_signature') violations.push(`${id}: unsigned permit is ${state}`)

      // An unreadable expiry is not a permit that never expires. Anything
      // other than 'active' is acceptable here; 'active' is not.
      const readable = Number.isFinite(new Date(expires).getTime())
      if (!cancelled && signed && !readable && state === 'active') {
        violations.push(`${id}: unreadable expiry left the permit ACTIVE`)
      }
      if (!cancelled && signed && readable && new Date(expires).getTime() < Date.now() && state !== 'expired') {
        violations.push(`${id}: past expiry is ${state}`)
      }
    }
    expect(violations).toEqual([])
  })
})

describe('safety-calculation census', () => {
  it('executed the full matrix', () => {
    console.log(`\n  ▸ safety-calculation cases executed: ${EXECUTED_CASES.toLocaleString()}\n`)
    expect(EXECUTED_CASES).toBeGreaterThanOrEqual(5_000)
  })
})
