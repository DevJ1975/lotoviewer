import { describe, it, expect } from 'vitest'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { AI_LIMITS } from '@/lib/ai/rateLimit'
import { OPERATOR_AGENTS, ORCHESTRATOR_SURFACE } from '@/lib/ai/operator/agents'

// Guards the recurring "added a surface to models.ts but not rateLimit.ts (or
// vice versa)" runtime break. Covers every surface, operator and legacy.
describe('AI surface registry stays in sync', () => {
  it('every model surface has a rate limit', () => {
    for (const surface of Object.keys(MODEL_BY_SURFACE)) {
      expect(AI_LIMITS, `missing AI_LIMITS for ${surface}`).toHaveProperty(surface)
    }
  })

  it('every rate-limited surface has a model', () => {
    for (const surface of Object.keys(AI_LIMITS)) {
      expect(MODEL_BY_SURFACE, `missing MODEL_BY_SURFACE for ${surface}`).toHaveProperty(surface)
    }
  })
})

describe('operator agent catalog', () => {
  it('every agent surface is registered in models + limits', () => {
    for (const agent of Object.values(OPERATOR_AGENTS)) {
      expect(MODEL_BY_SURFACE).toHaveProperty(agent.surface)
      expect(AI_LIMITS).toHaveProperty(agent.surface)
    }
  })

  it('the orchestrator surface is registered', () => {
    expect(MODEL_BY_SURFACE).toHaveProperty(ORCHESTRATOR_SURFACE)
    expect(AI_LIMITS).toHaveProperty(ORCHESTRATOR_SURFACE)
  })

  it('each agent id matches its surface suffix (operator-<id>)', () => {
    for (const agent of Object.values(OPERATOR_AGENTS)) {
      expect(agent.surface).toBe(`operator-${agent.id}`)
    }
  })
})
