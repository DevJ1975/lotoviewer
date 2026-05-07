import { describe, it, expect } from 'vitest'
import { AI_LIMITS, type AiSurface } from '@/lib/ai/rateLimit'

// The helpers themselves do live Supabase queries, so the meat of
// the logic isn't unit-testable in jsdom without a heavy mock. The
// contract worth pinning is the AI_LIMITS shape — every surface
// has limits, the chat surface matches the hardcoded constants in
// support/chat/route.ts, and limits are sane (per-day >= per-hour
// AND > 0).

const ALL_SURFACES: AiSurface[] = [
  'support-chat',
  'generate-loto-steps',
  'generate-confined-space-hazards',
]

describe('AI_LIMITS', () => {
  it('has an entry for every surface', () => {
    for (const s of ALL_SURFACES) {
      expect(AI_LIMITS[s]).toBeDefined()
    }
  })

  it('every surface has perHour > 0 and perDay > 0', () => {
    for (const s of ALL_SURFACES) {
      expect(AI_LIMITS[s].perHour).toBeGreaterThan(0)
      expect(AI_LIMITS[s].perDay).toBeGreaterThan(0)
    }
  })

  it('every surface has perDay >= perHour (a daily cap < an hourly cap is nonsense)', () => {
    for (const s of ALL_SURFACES) {
      expect(AI_LIMITS[s].perDay, `${s}: perDay >= perHour`).toBeGreaterThanOrEqual(AI_LIMITS[s].perHour)
    }
  })

  it('chat surface limits match the constants hardcoded in support/chat/route.ts', () => {
    expect(AI_LIMITS['support-chat']).toEqual({ perHour: 30, perDay: 200 })
  })

  it('the two heavy generation surfaces have identical limits (consistency)', () => {
    expect(AI_LIMITS['generate-loto-steps']).toEqual(AI_LIMITS['generate-confined-space-hazards'])
  })

  it('validate-photo is NOT a surface (photo AI was dropped)', () => {
    // Type-level check: AiSurface union no longer includes 'validate-photo'.
    // A future re-add will need to update this test deliberately.
    expect('validate-photo' in AI_LIMITS).toBe(false)
  })
})
