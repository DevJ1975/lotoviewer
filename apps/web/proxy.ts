// Edge proxy — Origin / Host cross-check on state-changing
// requests. (Next.js 16 renamed the `middleware` convention to
// `proxy`; functionality is identical.)
//
// Rationale:
//   The primary CSRF defence is SameSite=Lax cookies + bearer JWT
//   (no cookies are read on /api/* — every gate uses the
//   Authorization header). This proxy adds a second layer: if a
//   browser submits a state-changing request with an Origin that
//   doesn't match the Host, it's almost certainly a CSRF probe and
//   we reject early with 403.
//
// Scope:
//   POST / PATCH / PUT / DELETE on /api/* paths. GET / HEAD /
//   OPTIONS pass through unchanged.
//
// Bypasses:
//   - /api/cron/*    — server-to-server calls with no Origin and a
//                      bearer CRON_SECRET. The cron gate is the
//                      primary defence.
//   - /api/webhooks/*— inbound webhooks (Stripe, etc.) carry a
//                      signature header verified per-route.
//   - /api/anon/*    — anonymous report public submission. Captcha
//                      + IP throttle do the heavy lifting.
//   - /api/review/*  — tokenised public review portal. The token
//                      IS the credential.
//   - Requests with NO Origin header are allowed (covers curl, CI,
//     mobile native clients). The Authorization-header gate still
//     applies; this proxy is belt-and-suspenders only.

import { NextResponse, type NextRequest } from 'next/server'

const STATE_CHANGING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
const BYPASS_PREFIXES = [
  '/api/cron/',
  '/api/webhooks/',
  '/api/anon/',
  '/api/anonymous-report/',
  '/api/review/',
  '/api/health',
  '/api/scan/',  // public QR-scan token routing
]

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Only patrol /api/*; static + page routes are out of scope.
  if (!pathname.startsWith('/api/')) return NextResponse.next()
  if (!STATE_CHANGING.has(req.method)) return NextResponse.next()

  for (const prefix of BYPASS_PREFIXES) {
    if (pathname.startsWith(prefix)) return NextResponse.next()
  }

  const origin = req.headers.get('origin')
  if (!origin) return NextResponse.next()  // server-to-server / CLI

  // Compare Origin host to the request Host. Vercel forwards the
  // canonical Host in `host`; we accept any of the deploy's known
  // hosts (configurable via ALLOWED_ORIGIN_HOSTS — comma-separated).
  const reqHost = req.headers.get('host')?.toLowerCase() ?? ''
  let originHost: string
  try {
    originHost = new URL(origin).host.toLowerCase()
  } catch {
    return NextResponse.json(
      { error: 'Invalid Origin header' },
      { status: 403 },
    )
  }

  if (originHost === reqHost) return NextResponse.next()

  const allowList = (process.env.ALLOWED_ORIGIN_HOSTS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  if (allowList.includes(originHost)) return NextResponse.next()

  return NextResponse.json(
    { error: 'Origin mismatch' },
    { status: 403 },
  )
}

export const config = {
  // Run on every /api/* path. The proxy itself early-returns for
  // GET / HEAD / OPTIONS so the cost on hot read paths is one
  // method check.
  matcher: ['/api/:path*'],
}
