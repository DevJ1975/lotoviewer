import { FEATURES, isModuleVisible } from '@soteria/core'
import type { Tenant } from '@soteria/core/types'

// Per-tenant landing-page resolver. Called from app/page.tsx on
// every visit to `/` to decide whether to redirect the user to a
// module home (single-module tenants like Snak King → /loto) or
// render the existing multi-module dashboard.
//
// Three layers, first match wins:
//
//   1. Explicit override — `tenants.settings.default_landing_path`
//      is a string starting with `/`. Set by superadmin SQL until a
//      proper UI lands; useful for multi-module tenants who have a
//      strong preference (e.g. an EHS team that lives mostly on
//      /confined-spaces/status).
//
//   2. Single visible top-level module — if the tenant has exactly
//      one top-level module enabled (after applying tenants.modules
//      overrides on top of the static catalog), redirect there.
//      This is the zero-config path that solves Snak King: their
//      `modules` jsonb has `{loto: true}` and nothing else.
//
//   3. Otherwise → return null. Caller renders the multi-module
//      dashboard.
//
// Returns:
//   - A path string (always starts with '/') for layers 1 + 2.
//   - null for layer 3 (caller renders dashboard).
export function resolveLandingPath(tenant: Tenant | null): string | null {
  if (!tenant) return null

  // ─── Layer 1: explicit override ────────────────────────────────────
  const settings = (tenant.settings ?? {}) as Record<string, unknown>
  const overrideRaw = settings.default_landing_path
  if (typeof overrideRaw === 'string') {
    const trimmed = overrideRaw.trim()
    // Require absolute paths so a malformed value can't trick us into
    // navigating off-site or to a nonsense URL.
    if (trimmed.startsWith('/')) return trimmed
  }

  // ─── Layer 2: single visible safety module ────────────────────────
  // We only count the SAFETY category here, not reports / admin.
  // The reports-* and admin-* features are cross-cutting utility
  // entries that don't define a tenant's "module home" — every
  // tenant has them in some form. The "what's my one module"
  // question is really "which of LOTO / Confined Spaces / Hot Work
  // / etc. do I have."
  //
  // Other filters: top-level only (no parent), not coming-soon
  // (those don't route), and href must be a string (excludes
  // internal-only features like loto-review-portal that surface
  // inline on a host page rather than as their own drawer entry).
  const modules = tenant.modules ?? null
  const candidates = FEATURES
    .filter(f => f.category === 'safety')
    .filter(f => !f.parent)
    .filter(f => f.enabled && !f.comingSoon)
    .filter(f => isModuleVisible(f.id, modules))
    .filter((f): f is typeof f & { href: string } => typeof f.href === 'string')

  if (candidates.length === 1) return candidates[0]!.href

  // ─── Layer 3: multi-module → render dashboard ─────────────────────
  return null
}
