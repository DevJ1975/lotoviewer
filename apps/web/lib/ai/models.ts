// Single source of truth for Anthropic model ids used by the app.
//
// Why this exists: pre-Phase-1.3, three routes hardcoded
// `claude-sonnet-4-6` and one hardcoded `claude-haiku-4-5-20251001`
// independently. Updating to a new Sonnet release meant editing
// three separate files; updating posture (alias vs date-stamped)
// was inconsistent across surfaces.
//
// Pinning posture: alias-style for both families.
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
// The validate-photo surface previously used the date-stamped form
// (`claude-haiku-4-5-20251001`); aligned to the alias here for
// consistency. If a specific surface ever needs to pin to a date
// (e.g. to lock behavior for a regulatory eval), declare a separate
// constant — don't switch the shared one back to date-stamped.

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
  // validate-photo uses Haiku because the task is a simple visual
  // validity check + cost matters (per-upload).
  'validate-photo':                   HAIKU,
} as const

export type AiSurface = keyof typeof MODEL_BY_SURFACE
