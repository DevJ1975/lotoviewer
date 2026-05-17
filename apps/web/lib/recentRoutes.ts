// Recent-routes tracking for the navigation drawer.
//
// localStorage-backed list of the last N routes the user visited in the
// active tenant. Used by the drawer's "Recents" section so that the
// most likely next click is at the top of the list — replacing the
// hardcoded "Pinned" set that worked for a 3-module app but didn't
// scale as the catalog grew.
//
// The store is per-tenant because a user with cross-tenant access sees
// different surfaces depending on which tenant they're in; bleeding
// /admin/* recents from tenant A into tenant B would be confusing.
//
// Stored value is a `string[]` of pathnames, most-recent first. Items
// not present in the FEATURES registry at render time are filtered out
// (deliberately conservative — see useRecentRoutes for why).

const MAX_RECENTS = 5

// Paths we never want to surface as "Recents". The dashboard is the
// default landing; welcome/login are interstitials; settings shouldn't
// dominate the list.
const EXCLUDED_PATHS = new Set<string>([
  '/',
  '/welcome',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/admin',
  '/superadmin',
])

function storageKey(tenantId: string) {
  return `soteria.recents.${tenantId}`
}

function readSafe(tenantId: string): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(tenantId))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string')
  } catch {
    return []
  }
}

function writeSafe(tenantId: string, hrefs: string[]) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(tenantId), JSON.stringify(hrefs))
    window.dispatchEvent(new Event('soteria:recents-updated'))
  } catch {
    // localStorage can be denied in private browsing or filled to quota.
    // Recents are a UX nicety — failing silently is the right move.
  }
}

export function loadRecents(tenantId: string | null | undefined): string[] {
  if (!tenantId) return []
  return readSafe(tenantId)
}

export function pushRecent(tenantId: string | null | undefined, href: string | null | undefined): void {
  if (!tenantId || !href) return
  if (EXCLUDED_PATHS.has(href)) return
  // Drop query strings and trailing slashes — we want to dedupe a
  // visit to /loto and /loto?from=foo as the same recent.
  const normalized = normalizeHref(href)
  if (!normalized) return
  if (EXCLUDED_PATHS.has(normalized)) return

  const existing = readSafe(tenantId)
  const next = [normalized, ...existing.filter(h => h !== normalized)].slice(0, MAX_RECENTS)
  writeSafe(tenantId, next)
}

export function clearRecents(tenantId: string | null | undefined): void {
  if (!tenantId) return
  writeSafe(tenantId, [])
}

function normalizeHref(href: string): string | null {
  if (!href.startsWith('/')) return null
  const noQuery = href.split('?')[0].split('#')[0]
  if (noQuery.length > 1 && noQuery.endsWith('/')) return noQuery.slice(0, -1)
  return noQuery
}

export const RECENTS_LIMIT = MAX_RECENTS
export const RECENTS_EVENT = 'soteria:recents-updated'
