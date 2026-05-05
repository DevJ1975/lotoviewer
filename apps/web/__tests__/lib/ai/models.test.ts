import { describe, it, expect } from 'vitest'
import { SONNET, HAIKU, MODEL_BY_SURFACE, type AiSurface } from '@/lib/ai/models'

// The canonical contract. If a future PR drifts the alias-style
// pinning posture or accidentally points a surface at the wrong
// model, these tests catch it.

describe('ai/models constants', () => {
  it('SONNET is the alias-style id (no date suffix)', () => {
    expect(SONNET).toBe('claude-sonnet-4-6')
    expect(SONNET).not.toMatch(/\d{8}$/)
  })

  it('HAIKU is the alias-style id (no date suffix)', () => {
    expect(HAIKU).toBe('claude-haiku-4-5')
    expect(HAIKU).not.toMatch(/\d{8}$/)
  })

  it('every documented surface has a model assignment', () => {
    const surfaces: AiSurface[] = [
      'support-chat',
      'generate-loto-steps',
      'generate-confined-space-hazards',
      'validate-photo',
    ]
    for (const s of surfaces) {
      expect(MODEL_BY_SURFACE[s]).toBeTruthy()
      expect([SONNET, HAIKU]).toContain(MODEL_BY_SURFACE[s])
    }
  })

  it('the three reasoning surfaces use Sonnet', () => {
    expect(MODEL_BY_SURFACE['support-chat']).toBe(SONNET)
    expect(MODEL_BY_SURFACE['generate-loto-steps']).toBe(SONNET)
    expect(MODEL_BY_SURFACE['generate-confined-space-hazards']).toBe(SONNET)
  })

  it('validate-photo uses Haiku (cost optimization for the simple validity check)', () => {
    expect(MODEL_BY_SURFACE['validate-photo']).toBe(HAIKU)
  })
})
