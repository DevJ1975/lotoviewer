// Maps the web paths carried in push notifications (the `url` field of
// PushPayload) onto routes the Soteria FIELD mobile app can open. Server
// senders only know web paths; the app uses this to land on the right screen
// when a notification is tapped. Pure so web and mobile agree and it is
// testable.

export interface MobileRoute {
  pathname: string
  params:   Record<string, string>
}

const UUID = '[0-9a-fA-F-]{8,}'

const RULES: ReadonlyArray<{ pattern: RegExp; route: (m: RegExpMatchArray) => MobileRoute }> = [
  // Confined-space permit: web nests it under the space; mobile keys on the permit.
  {
    pattern: new RegExp(`^/confined-spaces/[^/]*/permits/(${UUID})$`),
    route:   m => ({ pathname: '/confined-spaces/[permitId]', params: { permitId: m[1]! } }),
  },
  {
    pattern: new RegExp(`^/hot-work/(${UUID})$`),
    route:   m => ({ pathname: '/hot-work/[permitId]', params: { permitId: m[1]! } }),
  },
  {
    // Incident sub-pages (actions, people) collapse onto the incident itself.
    pattern: new RegExp(`^/incidents/(${UUID})(?:/.*)?$`),
    route:   m => ({ pathname: '/incidents/[id]', params: { id: m[1]! } }),
  },
  {
    pattern: new RegExp(`^/near-miss/(${UUID})$`),
    route:   m => ({ pathname: '/near-miss/[id]', params: { id: m[1]! } }),
  },
]

// Returns null for paths the app has no screen for; the caller then just
// opens the app. Absolute URLs are reduced to their path first so a sender
// that builds `${appUrl}/…` still resolves.
export function mobileRouteForWebPath(raw: string | null | undefined): MobileRoute | null {
  if (!raw) return null
  let path = raw.trim()
  if (/^https?:\/\//i.test(path)) {
    try { path = new URL(path).pathname } catch { return null }
  }
  path = path.split(/[?#]/)[0]!.replace(/\/+$/, '')
  for (const rule of RULES) {
    const match = path.match(rule.pattern)
    if (match) return rule.route(match)
  }
  return null
}
