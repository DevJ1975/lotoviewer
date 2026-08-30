import { describe, it, expect } from 'vitest'
import { SONNET, HAIKU, OPUS, MODEL_BY_SURFACE, type AiSurface } from '@/lib/ai/models'

// The canonical contract. If a future PR drifts the alias-style
// pinning posture or accidentally points a surface at the wrong
// model, these tests catch it.

describe('ai/models constants', () => {
  it('SONNET is the alias-style id (no date suffix)', () => {
    expect(SONNET).toBe('claude-sonnet-5')
    expect(SONNET).not.toMatch(/\d{8}$/)
  })

  it('HAIKU is the alias-style id (no date suffix)', () => {
    expect(HAIKU).toBe('claude-haiku-4-5')
    expect(HAIKU).not.toMatch(/\d{8}$/)
  })

  it('OPUS is the alias-style id (no date suffix)', () => {
    expect(OPUS).toBe('claude-opus-5')
    expect(OPUS).not.toMatch(/\d{8}$/)
  })

  it('every documented surface has a model assignment', () => {
    const surfaces: AiSurface[] = [
      'support-chat',
      'generate-loto-steps',
      'generate-confined-space-hazards',
    ]
    for (const s of surfaces) {
      expect(MODEL_BY_SURFACE[s]).toBeTruthy()
      expect([SONNET, HAIKU, OPUS]).toContain(MODEL_BY_SURFACE[s])
    }
  })

  it('all three text-only surfaces use Sonnet', () => {
    expect(MODEL_BY_SURFACE['support-chat']).toBe(SONNET)
    expect(MODEL_BY_SURFACE['generate-loto-steps']).toBe(SONNET)
    expect(MODEL_BY_SURFACE['generate-confined-space-hazards']).toBe(SONNET)
  })

  it('LOTO audit uses barbell routing: Haiku for perception, Opus for the safety gate', () => {
    // High-volume perception/consistency passes go cheap; the safety-critical
    // Cal/OSHA gate + adversarial regulator review get the strongest model.
    expect(MODEL_BY_SURFACE['loto-audit-fpe']).toBe(HAIKU)
    expect(MODEL_BY_SURFACE['loto-audit-ds']).toBe(HAIKU)
    expect(MODEL_BY_SURFACE['loto-audit-ehs']).toBe(OPUS)
    expect(MODEL_BY_SURFACE['loto-audit-regulator']).toBe(OPUS)
    expect(MODEL_BY_SURFACE['loto-audit-author']).toBe(SONNET)
  })

  it('photo-related surfaces are NOT in MODEL_BY_SURFACE', () => {
    // validate-photo was removed; image content blocks were removed
    // from the generation routes. If someone re-introduces a photo
    // surface, this test forces a deliberate decision about what to
    // wire here.
    expect('validate-photo' in MODEL_BY_SURFACE).toBe(false)
  })
})
