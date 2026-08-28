// An AI route's worst-case wall clock is `timeout × (maxRetries + 1)`, and it
// has to leave room for everything else the request does. When it doesn't, the
// platform kills the function mid-flight and the caller gets a raw 504 — no
// error this codebase produced, nothing in Sentry from the route, and nothing
// the operator can act on.
//
// That is exactly what /api/assistant/hazards did: it took getAnthropic's
// defaults (30s × 3 attempts = 90s) against its own maxDuration of 90, leaving
// zero seconds for the rate-limit check, equipment lookup, k=10 RAG retrieval
// and JSON parse that also had to fit.
//
// These tests read the routes' declared numbers and check the arithmetic, so a
// future edit that raises a timeout or restores a retry has to face the budget
// rather than discover it in production.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function source(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8')
}

/** `export const maxDuration = N` */
function maxDuration(src: string): number | null {
  const m = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/)
  return m ? Number(m[1]) : null
}

/** The `{ timeoutMs, maxRetries }` a route hands getAnthropic. */
function anthropicBudget(src: string): { timeoutMs: number; maxRetries: number } | null {
  const call = src.match(/getAnthropic\([^)]*\{([^}]*)\}[^)]*\)/)
  if (!call) return null
  const timeout = call[1].match(/timeoutMs:\s*([\d_]+)/)
  const retries = call[1].match(/maxRetries:\s*(\d+)/)
  if (!timeout) return null
  return {
    timeoutMs:  Number(timeout[1].replace(/_/g, '')),
    // getAnthropic's default is 2 when the route does not say otherwise.
    maxRetries: retries ? Number(retries[1]) : 2,
  }
}

// Time the route spends OUTSIDE the model call — auth gate, rate limit, DB
// lookups, RAG retrieval, parsing — that the budget has to leave room for.
const OVERHEAD_RESERVE_SEC = 12

describe('AI route timeout budgets fit inside maxDuration', () => {
  // Every route that calls getAnthropic on a user-facing path. Each must
  // declare a ceiling and keep its AI budget under it — a route that declares
  // none inherits the platform default, which is far shorter than a single
  // model call, so a slow generation can never finish.
  const ROUTES = [
    'app/api/assistant/hazards/route.ts',
    'app/api/assistant/scan-photo/route.ts',
    'app/api/assistant/chat/route.ts',
    'app/api/generate-loto-steps/route.ts',
    'app/api/generate-confined-space-hazards/route.ts',
    'app/api/incidents/[id]/rca/assist/route.ts',
    'app/api/incidents/[id]/classify/ai-suggest/route.ts',
    'app/api/incidents/[id]/ecfa/assist/route.ts',
    'app/api/incidents/[id]/predict-escalation/route.ts',
    'app/api/insights/scorecard-focus/route.ts',
    'app/api/support/chat/route.ts',
  ]

  it('every AI route on this list declares a duration ceiling', () => {
    // The failure this guards against is silent: with no maxDuration the route
    // still deploys and still works for short answers, then 504s the moment a
    // generation runs long.
    const missing = ROUTES.filter(r => maxDuration(source(r)) === null)
    expect(missing, 'AI routes with no maxDuration').toEqual([])
  })

  it.each(ROUTES)('%s leaves room for the rest of the request', route => {
    const src = source(route)
    const declared = maxDuration(src)
    const budget = anthropicBudget(src)

    expect(declared, `${route} must declare maxDuration`).not.toBeNull()
    expect(budget, `${route} must pass an explicit timeoutMs to getAnthropic`).not.toBeNull()

    const worstCaseSec = (budget!.timeoutMs / 1000) * (budget!.maxRetries + 1)
    expect(
      worstCaseSec + OVERHEAD_RESERVE_SEC,
      `${route}: worst-case AI time ${worstCaseSec}s + ${OVERHEAD_RESERVE_SEC}s overhead exceeds maxDuration ${declared}s`,
    ).toBeLessThanOrEqual(declared!)
  })

  it('the hazard report does not retry a call that already ran long', () => {
    // Re-running a generation that blew its timeout will blow it again, and
    // the second attempt spends the headroom that would have carried a real
    // error back to the user.
    const budget = anthropicBudget(source('app/api/assistant/hazards/route.ts'))
    expect(budget?.maxRetries).toBe(0)
  })

  it('the defaults alone would not have fitted — which is why the route must be explicit', () => {
    // Pins the reason this file exists. getAnthropic's defaults are 30s × 3
    // attempts; against a 90s maxDuration that is the entire budget.
    const client = source('lib/ai/client.ts')
    const defTimeout = Number(client.match(/DEFAULT_TIMEOUT_MS\s*=\s*([\d_]+)/)![1].replace(/_/g, ''))
    const defRetries = Number(client.match(/DEFAULT_MAX_RETRIES\s*=\s*(\d+)/)![1])
    const declared = maxDuration(source('app/api/assistant/hazards/route.ts'))!

    const defaultWorstCaseSec = (defTimeout / 1000) * (defRetries + 1)
    expect(defaultWorstCaseSec + OVERHEAD_RESERVE_SEC).toBeGreaterThan(declared)
  })
})

describe('getAnthropic exposes the knobs a route needs to stay inside its budget', () => {
  it('accepts both timeoutMs and maxRetries', () => {
    const src = source('lib/ai/client.ts')
    expect(src).toMatch(/opts\?:\s*\{[\s\S]*?timeoutMs\?:\s*number/)
    expect(src).toMatch(/opts\?:\s*\{[\s\S]*?maxRetries\?:\s*number/)
    expect(src).toMatch(/maxRetries:\s*opts\?\.maxRetries\s*\?\?\s*DEFAULT_MAX_RETRIES/)
  })

  it('maps a client-side timeout to a 504 with actionable copy', () => {
    // A timeout carries no HTTP status, so before this branch it fell through
    // to the catch-all and read as "unexpected error".
    const src = source('lib/ai/client.ts')
    expect(src).toContain('APIConnectionTimeoutError')
    expect(src).toMatch(/status:\s*504/)
    expect(src).toMatch(/kind:\s*'timeout'/)
  })
})
