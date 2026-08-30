// Ancestor trail for a deep route, derived from the two catalogs the app
// already maintains: packages/core FEATURES and lib/adminCatalog.
//
// Nothing in the product showed where you were. /admin/people/contractors/
// <id>/prequalification rendered with a title and no trail, five levels
// down, with the back arrow — when a page bothered to pass one — as the
// only way up.
//
// The trail deliberately stops short of the current page: PageHeader's h1
// already names it, and repeating it in the crumbs is noise.

import { FEATURES } from '@soteria/core/features'
import { ADMIN_SECTIONS, getAllAdminTiles } from '@/lib/adminCatalog'

export interface Crumb {
  label: string
  /** null when the segment names a real place that is not a page — see below. */
  href: string | null
}

/** The /admin landing has no FEATURES row, so its name lives here. */
const ADMIN_ROOT: Crumb = { label: 'Administration', href: '/admin' }

/**
 * Ancestors of `pathname`, root-first, excluding the page itself.
 *
 * Returns an empty array for a module home (`/incidents`) — one crumb
 * pointing at the page you are already on teaches the user nothing.
 *
 * Segments that name no catalogued page are dropped rather than shown raw,
 * so a UUID in the middle of a path does not become a breadcrumb.
 */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length < 2) return []

  const crumbs: Crumb[] = []
  // `length - 1` stops before the current page.
  for (let cut = 1; cut < segments.length; cut++) {
    const crumb = crumbFor(segments.slice(0, cut))
    if (crumb) crumbs.push(crumb)
  }
  return crumbs
}

function crumbFor(prefix: string[]): Crumb | null {
  const path = `/${prefix.join('/')}`

  if (path === '/admin') return ADMIN_ROOT

  // An admin section (/admin/people) is a grouping, not a route: it
  // 301-redirects to /admin (see getAdminRedirects). Linking it would
  // bounce the user two levels up from a crumb that promised one, so the
  // section shows as text and the /admin crumb beside it carries the link.
  if (prefix.length === 2 && prefix[0] === 'admin') {
    const section = ADMIN_SECTIONS.find(s => s.urlSegment === prefix[1])
    return section ? { label: section.title, href: null } : null
  }

  const tile = getAllAdminTiles().find(t => t.href === path)
  if (tile) return { label: tile.title, href: tile.href }

  const feature = FEATURES.find(f => f.href === path && f.enabled && !f.comingSoon)
  if (feature) return { label: feature.name, href: path }

  return null
}
