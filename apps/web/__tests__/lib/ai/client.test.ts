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

  it('maps an unknown / un-shaped error to 502 and surfaces the message', () => {
    const r = aiErrorToResponse(new Error('something weird'), 'classify-recordability')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('unknown')
    expect(r.body.error).toMatch(/something weird/)
  })

  it('maps a non-Error throw (string) to 502 with a generic message', () => {
    const r = aiErrorToResponse('a string was thrown', 'assistant-chat')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('unknown')
    expect(r.body.error).toBe('The AI service returned an unexpected error.')
  })

  it('maps an upstream 400 to 502 with the upstream message surfaced', () => {
    // Anthropic SDK error shape: outer .error wraps an inner .error
    // with { type, message }. Surface that message so a superadmin
    // diagnosing a bad PDF upload knows whether it's the page count,
    // the size, or the content.
    const err = Object.assign(new Error('400 Bad Request'), {
      status: 400,
      error: {
        type:  'error',
        error: { type: 'invalid_request_error', message: 'PDF exceeds the 100-page limit.' },
      },
    })
    const r = aiErrorToResponse(err, 'parse-sds')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('upstream-400')
    expect(r.body.error).toMatch(/100-page limit/)
  })

  it('maps an upstream 403 with an upstream message', () => {
    const err = Object.assign(new Error('403 Forbidden'), {
      status: 403,
      error: { error: { message: 'Your account is not permitted to use this model.' } },
    })
    const r = aiErrorToResponse(err, 'support-chat')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('upstream-403')
    expect(r.body.error).toMatch(/not permitted/)
  })

  it('falls back to err.message when the SDK error shape is missing', () => {
    const err = Object.assign(new Error('weird 4xx'), { status: 422 })
    const r = aiErrorToResponse(err, 'parse-sds')
    expect(r.status).toBe(502)
    expect(r.tags.kind).toBe('upstream-422')
    expect(r.body.error).toMatch(/weird 4xx/)
  })

  it('truncates very long upstream messages', () => {
    const longMsg = 'x'.repeat(1000)
    const err = Object.assign(new Error('400'), {
      status: 400,
      error: { error: { message: longMsg } },
    })
    const r = aiErrorToResponse(err, 'parse-sds')
    expect(r.body.error.length).toBeLessThan(300)
    expect(r.body.error).toMatch(/…$/)
  })
})
