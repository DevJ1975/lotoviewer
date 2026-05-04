// Module visibility resolver — single source of truth for "is this feature
// surfaced to the active tenant?" Used by both the drawer (to hide list
// items) and the route guard (to 404 direct URL navigation).
//
// Three-way precedence:
//   1. Static `enabled = false` in lib/features.ts  → hidden everywhere,
//      no tenant can turn it back on (graveyarded features).
//   2. tenants.modules has an explicit boolean for this id → wins.
//   3. No override key → fall back to the static `enabled`.
//
// Children inherit their parent's resolution. Toggling the parent's
// row in `tenants.modules` flips the entire group on or off without
// the admin needing to touch every child.

import { getFeature } from '@/lib/features'

export function isModuleVisible(
  featureId: string,
  tenantModules: Record<string, boolean> | null | undefined,
): boolean {
  const def = getFeature(featureId)
  if (!def) return false
  if (!def.enabled) return false  // hard global disable

  // Walk up to the top-level parent — children always inherit.
  if (def.parent) return isModuleVisible(def.parent, tenantModules)

  // Top-level: tenant override wins, else static enabled (= true here).
  if (tenantModules && featureId in tenantModules) {
    return tenantModules[featureId] === true
  }
  return true
}
