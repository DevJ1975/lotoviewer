import { describe, it, expect } from 'vitest'
import { MODEL_BY_SURFACE, type AiSurface } from '@/lib/ai/models'
import { MODEL_PRICING } from '@/lib/ai/usageAggregator'
import { AI_LIMITS } from '@/lib/ai/rateLimit'

// Three registries have to agree for a new AI surface to be safe to ship:
//
//   models.ts        which model the surface calls
//   usageAggregator  what that model costs
//   rateLimit.ts     how often the surface may be called
//
// They are hand-maintained and nothing ties them together at the type level —
// AiSurface is literally declared twice, once derived from MODEL_BY_SURFACE and
// once as a hand-written union in rateLimit.ts. The failure is silent in the
// worst way: costForInvocation() falls back to Sonnet's rate for a model id it
// does not recognize, so a surface routed to an unpriced model bills at the
// wrong rate, checkTenantBudget under-counts, and a tenant's spend cap quietly
// stops enforcing. No error, no log line, just a budget that no longer holds.
//
// This is the test that turns that into a build failure.

const surfaces = Object.keys(MODEL_BY_SURFACE) as AiSurface[]

describe('AI registry coverage', () => {
  it('prices every model any surface routes to', () => {
    const unpriced = surfaces
      .filter(surface => !(MODEL_BY_SURFACE[surface] in MODEL_PRICING))
      .map(surface => `${surface} → ${MODEL_BY_SURFACE[surface]}`)

    expect(
      unpriced,
      `Add a MODEL_PRICING row in lib/ai/usageAggregator.ts for:\n  ${unpriced.join('\n  ')}`,
    ).toEqual([])
  })

  it('rate-limits every surface', () => {
    const unlimited = surfaces.filter(surface => !(surface in AI_LIMITS))
    expect(
      unlimited,
      `Add an AI_LIMITS entry in lib/ai/rateLimit.ts for:\n  ${unlimited.join('\n  ')}`,
    ).toEqual([])
  })

  it('has no rate limit for a surface that no longer exists', () => {
    // A stale limit is harmless at runtime but means the two files have drifted,
    // which is exactly the state that produced the unpriced-model bug.
    const known = new Set<string>(surfaces)
    const orphaned = Object.keys(AI_LIMITS).filter(surface => !known.has(surface))
    expect(orphaned, 'Remove these from AI_LIMITS or add them to MODEL_BY_SURFACE').toEqual([])
  })

  it('gives every priced model a positive, non-zero rate', () => {
    for (const [model, pricing] of Object.entries(MODEL_PRICING)) {
      expect(pricing.inputPerMTok, `${model} input`).toBeGreaterThan(0)
      expect(pricing.outputPerMTok, `${model} output`).toBeGreaterThan(0)
    }
  })

  it('sets a sane per-hour and per-day pair for every surface', () => {
    for (const [surface, limit] of Object.entries(AI_LIMITS)) {
      expect(limit.perHour, `${surface} perHour`).toBeGreaterThan(0)
      expect(limit.perDay, `${surface} perDay`).toBeGreaterThanOrEqual(limit.perHour)
    }
  })
})
