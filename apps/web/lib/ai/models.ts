// Single source of truth for Anthropic model ids used by the app.
//
// Pinning posture: alias-style.
//
//   - SONNET = 'claude-sonnet-4-6'   (NOT claude-sonnet-4-6-20250930)
//   - HAIKU  = 'claude-haiku-4-5'    (NOT claude-haiku-4-5-20251001)
//   - OPUS   = 'claude-opus-4-8'     (NOT claude-opus-4-8-<date>)
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
//
// The multi-agent LOTO audit uses cost-tiered ("barbell") routing: its
// high-volume perception + consistency passes (FPE vision, DS) run on
// Haiku, while the safety-critical Cal/OSHA gate (EHS) and the
// adversarial regulator review run on Opus — strongest reasoning where a
// wrong call is most costly. See the audit block in MODEL_BY_SURFACE.

export const SONNET = 'claude-sonnet-4-6' as const
export const HAIKU  = 'claude-haiku-4-5'  as const
export const OPUS   = 'claude-opus-4-8'   as const

export type ModelId = typeof SONNET | typeof HAIKU | typeof OPUS

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
  // SDS parsing reads a multi-page PDF and emits a long structured
  // JSON payload. Sonnet's accuracy on technical regulatory content
  // is worth the extra cost — and every parse runs through a human
  // review queue before fields land on the product.
  'parse-sds':                        SONNET,
  // SDS discovery: web-search to locate a manufacturer SDS PDF, then a
  // structured-output pass to normalize candidates. Sonnet — the search
  // reasoning is the same class as parse-sds, and web_search is supported.
  'discover-sds':                     SONNET,
  // Seeding the global SDS library: web-search to PROPOSE the most common
  // industrial chemicals (name + CAS + manufacturer), then a structured pass
  // to normalize the list. Sonnet — same search-reasoning class as discover.
  'seed-sds-list':                    SONNET,
  // Cross-module assistant on the home page. Tool-use heavy, must
  // reason across LOTO + confined-spaces + chemicals + incidents +
  // uploaded company policies. Sonnet for the chat itself.
  'assistant-chat':                   SONNET,
  // Equipment-nameplate scan via Claude vision. Sonnet because OCR
  // accuracy on weathered nameplates matters for the next step.
  'assistant-scan-photo':             SONNET,
  // Hazard report generation. Combines structured equipment + RAG +
  // OSHA/DOT/EPA citations into a structured response — Sonnet.
  'assistant-hazards':                SONNET,
  // Admin/operator AI surfaces. These summarize operational evidence
  // and produce narrative output that a human reviews before acting.
  'summarize-audit':                  SONNET,
  'classify-near-miss':               SONNET,
  'superadmin-daily-report':          SONNET,
  // Severity-prediction is a short, structured Q&A — Haiku is the
  // right cost/accuracy trade. Admin always reviews before any
  // mutation; the model never auto-edits severity_actual.
  'predict-incident-escalation':      HAIKU,
  // ── Multi-agent LOTO audit (FPE / DS / EHS / Author / Regulator) ──────────
  // An OFFLINE audit pass over already-stored photos + procedures whose every
  // proposed fix is surfaced through a human-approval review link before it
  // touches live data — so it does NOT reintroduce the latency/cost-on-every-
  // upload that drove the original per-upload photo gate's removal.
  //
  // Cost-tiered ("barbell") routing for this high-fan-out sweep: the two
  // high-volume perception/consistency passes run on Haiku; the safety-critical
  // Cal/OSHA judgement runs on Opus. The bulk of the calls get ~3x cheaper while
  // the gate gets the strongest reasoning where a wrong call is most costly.
  //
  // loto-audit-fpe: Food-Production-Engineer vision agent — judges the equipment
  //   + isolation photos. Haiku 4.5 (vision-capable). Once per machine on image-
  //   heavy input, so it dominates token spend; the conservative downstream hard
  //   gate (placeholder/missing/mismatch ⇒ fail) plus human review bound the risk
  //   of a cheaper photo read.
  'loto-audit-fpe':                   HAIKU,
  // loto-audit-ds: Data-Scientist consistency agent. Reconciles description ↔
  //   energy codes ↔ steps ↔ OSHA phases ↔ FPE verdicts — structured, text-only,
  //   high volume. Haiku.
  'loto-audit-ds':                    HAIKU,
  // loto-audit-ehs: Senior EHS Specialist gate. Cites Cal/OSHA T8 §3314 +
  //   1910.147 + Z244.1 and holds pass/fail authority — the safety-critical
  //   decision. Opus 4.8 for the strongest compliance reasoning.
  'loto-audit-ehs':                   OPUS,
  // loto-audit-author: drafts a CORRECTED, bilingual energy-control procedure for
  //   a machine the gate failed. Reuses the proven generate-loto-steps prompt and
  //   stays on Sonnet — draft quality matters (a reviewer reads every one) but it
  //   is never applied automatically, and its long output makes Opus costly here.
  //   Bump to OPUS if top-tier draft prose is worth the spend.
  'loto-audit-author':                SONNET,
  // loto-audit-regulator: veteran Cal/OSHA CSHO who adversarially re-reviews the
  //   EHS audit per machine and audits the program end-to-end, driving EHS
  //   corrections. Same safety-critical class as the gate — Opus 4.8. Critique is
  //   staged for the human review gate; it never writes live data.
  'loto-audit-regulator':             OPUS,
} as const

export type AiSurface = keyof typeof MODEL_BY_SURFACE
