import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  AnthropicNotConfiguredError,
  aiErrorToResponse,
} from '@/lib/ai/client'
import { MalformedTenantKeyError } from '@/lib/ai/getTenantApiKey'

// Pure-function tests for aiErrorToResponse. Covers the public
// HTTP-mapping contract — every error type the shared client wrapper
// can raise gets a deterministic (status, message, tags) triple that
// route handlers return verbatim.
//
// The integration that calls getAnthropic() against a live SDK is
// tested via the per-route tests under __tests__/api/ai/ (those
// already use the @anthropic-ai/sdk mock from _helpers.ts).

describe('aiErrorToResponse', () => {
  it('maps MalformedTenantKeyError to 502 with a tenant-fix message', () => {
    const err = new MalformedTenantKeyError('tenant-1', 'wrong-prefix')
    const r = aiErrorToResponse(err, 'assistant-chat')
    expect(r.status).toBe(502)
    expect(r.body.error).toMatch(/malformed/i)
    expect(r.body.error).toMatch(/Superadmin/i)
    expect(r.tags).toMatchObject({ surface: 'assistant-chat', kind: 'malformed-tenant-key' })
  })

  it('maps AnthropicNotConfiguredError to 503 with an admin-contact message', () => {
    const r = aiErrorToResponse(new AnthropicNotConfiguredError(), 'support-chat')
    expect(r.status).toBe(503)
    expect(r.body.error).toMatch(/not configured/i)
    expect(r.tags.kind).toBe('not-configured')
  })

  it('maps an upstream 429 to 429 with retryAfterSec', () => {
    const err = Object.assign(new Error('rate limited'), { status: 429 })
    const r = aiErrorToResponse(err, 'parse-sds')
    expect(r.status).toBe(429)
    expect(r.body.retryAfterSec).toBeGreaterThan(0)
    expect(r.tags.kind).toBe('upstream-429')
  })

  it('maps an upstream 5xx to 502', () => {
    const err = Object.assign(new Error('upstream gateway'), { status: 503 })
    const r = aiErrorToResponse(err, 'generate-loto-steps')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('upstream-5xx')
  })

  it('maps an unknown / un-shaped error to 502', () => {
    const r = aiErrorToResponse(new Error('something weird'), 'classify-recordability')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('unknown')
  })

  it('maps a non-Error throw (string) to 502', () => {
    const r = aiErrorToResponse('a string was thrown', 'assistant-chat')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('unknown')
  })

  it('does NOT bucket a 4xx (other than 429) as 5xx', () => {
    const err = Object.assign(new Error('forbidden'), { status: 403 })
    const r = aiErrorToResponse(err, 'support-chat')
    // 403 is not a known shape — falls through to 'unknown' / 502. The
    // contract is: only 429 + 5xx have specific buckets; everything
    // else is "unexpected".
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('unknown')
  })
})
