// Per-tenant memory of which drawer modules the user has opened or closed.
//
// Why this exists: the drawer used to derive expansion purely from the active
// route — `expanded = hasChildren && active` — so a module's children were
// only ever visible once you were already inside it. That hides 46 child
// pages behind knowing they exist. Chemicals alone has 11 (SDS Library,
// Tier II Report, MAQ Caps, Approval Queue…), none reachable from the drawer
// until you had navigated to /chemicals by some other means.
//
// The state is a Record<moduleId, boolean> and NOT a Set of open ids, because
// there are three cases, not two:
//
//   undefined → the user has no opinion; fall back to "open if active"
//   true      → explicitly opened (peek into a module you are not in)
//   false     → explicitly closed (collapse the module you ARE in)
//
// A Set can only encode two of those, and faking the third with a sentinel
// key is the kind of cleverness that costs the next reader more than it saves.
//
// Stored per tenant, matching the `soteria.recents.{tenantId}` convention —
// module sets differ per tenant, so one shared record would leak a tenant's
// enabled modules into another tenant's drawer.

export type NavExpansion = Record<string, boolean>

const KEY_PREFIX = 'soteria.nav.expanded.'

export const NAV_EXPANSION_EVENT = 'soteria:nav-expansion-updated'

function keyFor(tenantId: string): string {
  return `${KEY_PREFIX}${tenantId}`
}

/**
 * The user's explicit open/closed choices. Returns an empty record for a null
 * tenant, unparseable JSON, or a private-mode storage throw — in every failure
 * case the drawer falls back to active-route expansion, which is exactly the
 * behaviour that shipped before this existed.
 */
export function readExpansion(tenantId: string | null): NavExpansion {
  if (!tenantId) return {}
  try {
    const raw = localStorage.getItem(keyFor(tenantId))
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: NavExpansion = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') out[id] = value
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Persist and notify listeners in this tab. The `storage` event only fires in
 * *other* tabs, so the same-tab custom event is what keeps two drawer
 * instances in step — the pairing recentRoutes.ts already uses.
 */
export function writeExpansion(tenantId: string | null, expansion: NavExpansion): void {
  if (!tenantId) return
  try {
    localStorage.setItem(keyFor(tenantId), JSON.stringify(expansion))
    window.dispatchEvent(new Event(NAV_EXPANSION_EVENT))
  } catch {
    // Private mode / quota. Expansion is a convenience, never a gate — losing
    // it costs the user one click, so failing silently is correct here.
  }
}

/**
 * Whether a module's children should show.
 *
 * `active` is the fallback, so with no stored preference the drawer behaves
 * exactly as it did before this file existed.
 */
export function isExpanded(expansion: NavExpansion, moduleId: string, active: boolean): boolean {
  return expansion[moduleId] ?? active
}

/**
 * Flip one module, returning the new record. Records the *result* explicitly
 * rather than deleting the key, so "I closed the module I'm standing in"
 * survives — deleting would let `active` immediately re-open it.
 */
export function toggleExpansion(
  expansion: NavExpansion,
  moduleId: string,
  active: boolean,
): NavExpansion {
  return { ...expansion, [moduleId]: !isExpanded(expansion, moduleId, active) }
}
