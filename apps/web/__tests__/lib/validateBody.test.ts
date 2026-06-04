import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { validateJsonBody, validateQueryParams } from '@/lib/security/validateBody'

function jsonReq(body: unknown): Request {
  return new Request('http://x/', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

const Body = z.object({
  name:    z.string().min(1).max(120),
  count:   z.number().int().nonnegative(),
  modules: z.record(z.string(), z.boolean()).optional(),
})

describe('validateJsonBody', () => {
  it('returns ok+typed data on a valid payload', async () => {
    const r = await validateJsonBody(jsonReq({ name: 'a', count: 3 }), Body)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.name).toBe('a')
      expect(r.data.count).toBe(3)
    }
  })

  it('returns a 400 NextResponse on missing required fields', async () => {
    const r = await validateJsonBody(jsonReq({ name: 'a' }), Body)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
      const body = await r.response.json() as { error: string; issues: Array<{ path: string }> }
      expect(body.error).toMatch(/invalid/i)
      expect(body.issues.some(i => i.path === 'count')).toBe(true)
    }
  })

  it('catches nested field type mismatches the hand-rolled style misses', async () => {
    // The bug pattern: `modules: Record<string, boolean>` accepted
    // `{ safety: "INJECT" }` because the route only checked `typeof body.modules === 'object'`.
    const r = await validateJsonBody(jsonReq({ name: 'a', count: 1, modules: { safety: 'INJECT' } }), Body)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.response.status).toBe(400)
      const body = await r.response.json() as { issues: Array<{ path: string }> }
      expect(body.issues.some(i => i.path.startsWith('modules.safety'))).toBe(true)
    }
  })

  it('returns 400 on malformed JSON without throwing', async () => {
    const bad = new Request('http://x/', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{not json',
    })
    const r = await validateJsonBody(bad, Body)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })

  it('caps the issues list at 20 to prevent response bloat', async () => {
    const huge = z.object(Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`f${i}`, z.string()]),
    ))
    const r = await validateJsonBody(jsonReq({}), huge)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const body = await r.response.json() as { issues: unknown[] }
      expect(body.issues.length).toBeLessThanOrEqual(20)
    }
  })
})

describe('validateQueryParams', () => {
  it('coerces string params and validates', () => {
    const Q = z.object({
      days:  z.coerce.number().int().min(1).max(90),
      kind:  z.enum(['invite', 'reminder']).optional(),
    })
    const r = validateQueryParams(new URL('http://x/?days=7&kind=invite'), Q)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.days).toBe(7)
      expect(r.data.kind).toBe('invite')
    }
  })

  it('rejects out-of-range numerics with a 400', () => {
    const Q = z.object({ days: z.coerce.number().int().min(1).max(90) })
    const r = validateQueryParams(new URL('http://x/?days=9999'), Q)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.response.status).toBe(400)
  })
})
