// Smoke tests for /api/assistant/hazards. Pins the early-exit contracts:
// gate, rate limit, body validation. The full happy path requires a
// supabase query-builder stub and is covered by manual e2e.

import { describe, it, expect, beforeEach } from 'vitest'
import { resetAiMocks, gateRejects, rateLimitBlocks } from './_helpers'

function jsonRequest(body: unknown): Request {
  return new Request('http://x/api/assistant/hazards', {
    method: 'POST',
    headers: {
      authorization:    'Bearer t',
      'x-active-tenant': '00000000-0000-0000-0000-000000000001',
      'content-type':    'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { resetAiMocks() })

describe('POST /api/assistant/hazards — early exits', () => {
  it('returns 401 when the gate rejects', async () => {
    gateRejects(401, 'Missing bearer token')
    const { POST } = await import('@/app/api/assistant/hazards/route')
    const res = await POST(jsonRequest({ equipment_id: 'MIX-04' }))
    expect(res.status).toBe(401)
  })

  it('returns 400 on missing equipment_id', async () => {
    const { POST } = await import('@/app/api/assistant/hazards/route')
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/equipment_id/)
  })

  it('returns 400 on whitespace-only equipment_id', async () => {
    const { POST } = await import('@/app/api/assistant/hazards/route')
    const res = await POST(jsonRequest({ equipment_id: '  \t' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on invalid JSON body', async () => {
    const { POST } = await import('@/app/api/assistant/hazards/route')
    const req = new Request('http://x/api/assistant/hazards', {
      method:  'POST',
      headers: {
        authorization:    'Bearer t',
        'x-active-tenant': '00000000-0000-0000-0000-000000000001',
        'content-type':    'application/json',
      },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 429 when rate limiter blocks', async () => {
    rateLimitBlocks('hourly', 60)
    const { POST } = await import('@/app/api/assistant/hazards/route')
    const res = await POST(jsonRequest({ equipment_id: 'MIX-04' }))
    expect(res.status).toBe(429)
  })
})
