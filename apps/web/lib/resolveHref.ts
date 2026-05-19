// Resolves an arbitrary in-app href to a user-facing label + icon by
// walking the two registries we treat as catalogs:
//
//   1. packages/core/src/features.ts — top-level modules and their
//      children (drawer + dashboard grid).
//   2. apps/web/lib/adminCatalog.ts — every tile on /admin.
//
// Used by the drawer's Recents section. A path that doesn't match
// either registry (e.g. a deep equipment detail page) returns null —
// the caller decides whether to display the raw path or skip it.

import { FEATURES } from '@soteria/core/features'
import { getAllAdminTiles } from '@/lib/adminCatalog'
import { getModuleVisuals, type ModuleIconComponent } from '@/lib/moduleVisuals'

// Icon type is the looser ModuleIconComponent (a ComponentType with
// className + SVG props) so we can mix Lucide icons from the admin
// catalog with the module visuals' wrapped icons without a cast.

export interface ResolvedHref {
  href:    string
  label:   string
  Icon:    ModuleIconComponent
  source:  'feature' | 'admin'
}

export function resolveHref(href: string): ResolvedHref | null {
  // Feature lookup first — both top-level and children. The drawer
  // catalog covers most reachable surfaces, so this is the common case.
  const feature = FEATURES.find(f => f.href === href && f.enabled && !f.comingSoon)
  if (feature) {
    const parent = feature.parent ? FEATURES.find(f => f.id === feature.parent) : null
    const { Icon } = getModuleVisuals(parent?.id ?? feature.id)
    const label = parent
      ? `${parent.name} / ${feature.name}`
      : feature.name
    return { href, label, Icon, source: 'feature' }
  }

  // Admin landing tiles cover /admin/* paths that aren't in FEATURES.
  const tile = getAllAdminTiles().find(t => t.href === href)
  if (tile) {
    return { href, label: tile.title, Icon: tile.icon, source: 'admin' }
  }

  return null
}
