import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @sentry/nextjs before importing the module under test.
// Use vi.hoisted so the mock factory variables are defined when
// vi.mock's hoisting runs (it lifts vi.mock above all imports).
const { captureExceptionMock } = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: captureExceptionMock,
  captureMessage:   vi.fn(),
}))

import { sanitizeError, badRequest } from '@/lib/security/sanitizeError'

describe('sanitizeError', () => {
  beforeEach(() => {
    captureExceptionMock.mockClear()
  })

  it('always captures the full exception to Sentry with route tag', async () => {
    const e = new Error('relation "tenants" does not exist (LINE 3: select x from tenants)')
    sanitizeError(e, 'incidents/POST')
    expect(captureExceptionMock).toHaveBeenCalledOnce()
    const [actualErr, opts] = captureExceptionMock.mock.calls[0]
    expect(actualErr).toBe(e)
    expect(opts.tags.route).toBe('incidents/POST')
  })

  it('returns generic 500 + opaque error for unrecognised exceptions', async () => {
    const res = sanitizeError(new Error('some db internal'), 'test')
    const body = await res.json()
    expect(res.status).toBe(500)
    expect(body).toEqual({ error: 'internal' })
  })

  it('does not leak the original error message to the client', async () => {
    const e = { message: 'permission denied for relation profiles', code: 'unknown' }
    const res = sanitizeError(e, 'test')
    const body = await res.json()
    expect(JSON.stringify(body)).not.toContain('permission denied')
    expect(JSON.stringify(body)).not.toContain('profiles')
  })

  it('maps SQLSTATE 23505 (unique violation) to 409 conflict', async () => {
    const res = sanitizeError({ code: '23505', message: 'duplicate key value' }, 'test')
    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body).toEqual({ error: 'conflict' })
  })

  it('maps SQLSTATE 42501 (insufficient_privilege) to 403 forbidden', async () => {
    const res = sanitizeError({ code: '42501', message: 'permission denied for relation tenants' }, 'test')
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body).toEqual({ error: 'forbidden' })
  })

  it('maps PostgREST PGRST116 (single() returned 0) to 404', async () => {
    const res = sanitizeError({ code: 'PGRST116', message: 'JSON object requested' }, 'test')
    const body = await res.json()
    expect(res.status).toBe(404)
    expect(body).toEqual({ error: 'not_found' })
  })
})

describe('badRequest', () => {
  it('preserves the route-author-chosen message at status 400', async () => {
    const res = badRequest('Name is required')
    const body = await res.json()
    expect(res.status).toBe(400)
    expect(body).toEqual({ error: 'Name is required' })
  })
  it('accepts a custom status code', async () => {
    const res = badRequest('Too large', 413)
    expect(res.status).toBe(413)
  })
})
