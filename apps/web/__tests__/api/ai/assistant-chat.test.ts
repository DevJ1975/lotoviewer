// Smoke tests for /api/assistant/chat — early-exit paths only.
//
// The route writes/reads multiple Supabase tables (assistant_conversations,
// assistant_messages, tenants), runs a tool-use loop, and persists tool
// history. A full happy-path integration test means stubbing the entire
// query builder, which is its own slice of work — covered in PR2 alongside
// the streaming refactor.
//
// What's pinned here today: the public early-exit contracts that don't
// require any Supabase response. Each of these returns BEFORE the route
// touches a domain table, so the existing _helpers harness is enough.

import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetAiMocks, gateRejects, rateLimitBlocks,
} from './_helpers'

function jsonRequest(body: unknown): Request {
  return new Request('http://x/api/assistant/chat', {
    method:  'POST',
    headers: {
      authorization:    'Bearer t',
      'x-active-tenant': '00000000-0000-0000-0000-000000000001',
      'content-type':    'application/json',
    },
    body: JSON.stringify(body),
  })
}

beforeEach(() => { resetAiMocks() })

describe('POST /api/assistant/chat — early exits', () => {
  it('returns 401 when the gate rejects', async () => {
    gateRejects(401, 'Missing bearer token')
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({ message: 'hello' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Missing bearer token')
  })

  it('returns 403 when the user is not a tenant member', async () => {
    gateRejects(403, 'Not a member of this tenant')
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({ message: 'hello' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON body', async () => {
    const { POST } = await import('@/app/api/assistant/chat/route')
    const req = new Request('http://x/api/assistant/chat', {
      method: 'POST',
      headers: {
        authorization: 'Bearer t',
        'x-active-tenant': '00000000-0000-0000-0000-000000000001',
        'content-type': 'application/json',
      },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 400 on missing message field', async () => {
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({}))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/required/i)
  })

  it('returns 400 on empty message after trim', async () => {
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({ message: '   \n\t' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on message exceeding the 4000-char cap', async () => {
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({ message: 'x'.repeat(4001) }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/too long/i)
  })

  it('returns 429 when the rate limiter blocks (hourly)', async () => {
    rateLimitBlocks('hourly', 60)
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({ message: 'hello' }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/hourly/)
    expect(body.retryAfterSec).toBe(60)
  })

  it('returns 429 when the rate limiter blocks (daily)', async () => {
    rateLimitBlocks('daily', 86400)
    const { POST } = await import('@/app/api/assistant/chat/route')
    const res = await POST(jsonRequest({ message: 'hello' }))
    expect(res.status).toBe(429)
    const body = await res.json()
    expect(body.error).toMatch(/daily/)
  })
})
