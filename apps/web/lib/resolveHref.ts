// Resolves an arbitrary in-app href to a user-facing label + icon by
// walking the two registries we treat as catalogs:
//
//   1. packages/core/src/features.ts — top-level modules and their
//      children (drawer + dashboard grid).
//   2. apps/web/lib/adminCatalog.ts — every tile on /admin.
//
// Used by the drawer's Recents section.
//
// A path in neither registry used to return null, and the drawer dropped it.
// That silently emptied Recents of the only pages worth returning to: with 128
// dynamic route segments, an incident, a chemical or a piece of equipment is
// exactly the thing a user wants to get back to, and none of them are in a
// catalog. The one surface meant to adapt to the user ignored most of what
// they did.
//
// So detail paths now resolve against their nearest catalogued ancestor —
// /incidents/abc123 borrows Incidents' icon and reads "Incidents / abc123" —
// and only a genuinely unmatchable path returns null.

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

  return resolveDetailHref(href)
}

/**
 * Fallback for a detail page — anything under a catalogued route that the
 * catalogs themselves can't name, which is every `[id]` segment in the app.
 *
 * Walks the path from longest prefix to shortest so the most specific ancestor
 * wins: `/admin/people/contractors/<id>/prequalification` should read as
 * "Contractors", not "Administration".
 *
 * The trailing segment is shown raw rather than looked up. Resolving it to a
 * real title would mean a network round-trip per Recents row for a list that
 * renders on every drawer open, and a UUID the user just visited is still a
 * better memory aid than dropping the row entirely — which is what happened
 * before.
 */
function resolveDetailHref(href: string): ResolvedHref | null {
  const segments = href.split('/').filter(Boolean)
  if (segments.length < 2) return null

  const adopted = adoptDetailRoot(segments)
  if (adopted) return adopted

  for (let cut = segments.length - 1; cut >= 1; cut--) {
    const prefix = `/${segments.slice(0, cut).join('/')}`

    const feature = FEATURES.find(f => f.href === prefix && f.enabled && !f.comingSoon)
    if (feature) {
      const { Icon } = getModuleVisuals(feature.parent ?? feature.id)
      return { href, label: `${feature.name} / ${leafLabel(segments)}`, Icon, source: 'feature' }
    }

    const ancestorTile = getAllAdminTiles().find(t => t.href === prefix)
    if (ancestorTile) {
      return { href, label: `${ancestorTile.title} / ${leafLabel(segments)}`, Icon: ancestorTile.icon, source: 'admin' }
    }
  }

  return null
}

/**
 * Detail routes whose URL root is not itself a page, so the prefix walk above
 * finds nothing to borrow from.
 *
 * `/equipment/[id]` is the case that matters: there is no `/equipment` index,
 * and the module that owns it is LOTO at `/loto`. It is also the most-visited
 * detail page in the product, so leaving it unresolvable would miss most of
 * the point of this change.
 *
 * Deliberately not extended to the other index-less roots — `/qr`, `/review`,
 * `/witness`, `/permit-signon`, `/contractor-prequal`, `/report` are public or
 * token-scoped surfaces that have no business in a Recents list.
 */
const DETAIL_ROOT_MODULES: Record<string, string> = {
  equipment: 'loto',
}

function adoptDetailRoot(segments: string[]): ResolvedHref | null {
  const owningId = DETAIL_ROOT_MODULES[segments[0] ?? '']
  if (!owningId) return null

  const owner = FEATURES.find(f => f.id === owningId && f.enabled && !f.comingSoon)
  if (!owner) return null

  const { Icon } = getModuleVisuals(owner.id)
  return {
    href: `/${segments.join('/')}`,
    label: `${owner.name} / ${leafLabel(segments)}`,
    Icon,
    source: 'feature',
  }
}

// Long ids (UUIDs especially) would push the module name out of a 22rem
// drawer, so show enough to tell two rows apart and no more.
function leafLabel(segments: string[]): string {
  const leaf = decodeURIComponent(segments[segments.length - 1] ?? '')
  return leaf.length > 12 ? `${leaf.slice(0, 12)}…` : leaf
}
