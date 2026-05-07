// Single source of truth for Anthropic model ids used by the app.
//
// Pinning posture: alias-style.
//
//   - SONNET = 'claude-sonnet-4-6'   (NOT claude-sonnet-4-6-20250930)
//   - HAIKU  = 'claude-haiku-4-5'    (NOT claude-haiku-4-5-20251001)
//
// The alias auto-rolls forward within a model's lifecycle (e.g.
// Anthropic ships claude-sonnet-4-6-20260101 and the alias starts
// pointing at it); this is desirable for non-regressive bug fixes.
// Major-version transitions (4.6 → 4.7) require a deliberate edit
// to this file, which is the right blast radius — one PR review,
// one test pass, one env-var unchanged.
//
// Photo-related AI surfaces were dropped per the operator's call:
// every uploaded photo gets reviewed by a human before sign-off
// anyway, so an AI gate added latency + cost without changing the
// review burden. validate-photo (the per-upload subject check),
// plus the image-content blocks in the two generation routes, are
// gone. Sonnet 4.6 stays on the chat + structured-output surfaces.
// Haiku is kept available in this module in case a future
// lightweight text-only surface wants it.

export const SONNET = 'claude-sonnet-4-6' as const
export const HAIKU  = 'claude-haiku-4-5'  as const

export type ModelId = typeof SONNET | typeof HAIKU

/**
 * Surface → model selection. Single point of override if a surface
 * needs to swap models without touching its route code.
 */
export const MODEL_BY_SURFACE = {
  'support-chat':                     SONNET,
  'generate-loto-steps':              SONNET,
  'generate-confined-space-hazards':  SONNET,
  // Recordability assist runs Haiku — small reasoning surface,
  // structured Q&A, human always reviews before save.
  'classify-recordability':           HAIKU,
} as const

export type AiSurface = keyof typeof MODEL_BY_SURFACE
