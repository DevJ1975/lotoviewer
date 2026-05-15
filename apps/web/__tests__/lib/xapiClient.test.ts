import { describe, it, expect } from 'vitest'
import { basicAuthHeader, joinStatementUrl, postStatement } from '@/lib/xapi/client'
import type { XapiEndpoint, XapiStatement } from '@/lib/xapi/types'

function endpoint(overrides: Partial<XapiEndpoint> = {}): XapiEndpoint {
  return {
    id:          'endpoint-1',
    tenantId:    'tenant-1',
    endpointUrl: 'https://lrs.example.com/xapi',
    authKey:     'key',
    authSecret:  'secret',
    version:     '1.0.3',
    active:      true,
    ...overrides,
  }
}

const STATEMENT: XapiStatement = {
  id:        '00000000-0000-4000-8000-000000000001',
  actor:     { objectType: 'Agent', mbox: 'mailto:user@example.com' },
  verb:      { id: 'http://adlnet.gov/expapi/verbs/completed', display: { 'en-US': 'completed' } },
  object:    { objectType: 'Activity', id: 'https://soteria.field/xapi/activities/x' },
  timestamp: '2026-05-15T12:00:00.000Z',
}

describe('basicAuthHeader', () => {
  it('encodes key:secret using base64', () => {
    expect(basicAuthHeader('key', 'secret')).toBe(`Basic ${btoa('key:secret')}`)
  })

  it('handles credentials containing colons by joining only the first', () => {
    const header = basicAuthHeader('user', 'p:a:s:s')
    expect(header).toBe(`Basic ${btoa('user:p:a:s:s')}`)
  })
})

describe('joinStatementUrl', () => {
  it('appends /statements when missing', () => {
    expect(joinStatementUrl('https://lrs.example.com/xapi'))
      .toBe('https://lrs.example.com/xapi/statements')
  })

  it('strips trailing slash before appending', () => {
    expect(joinStatementUrl('https://lrs.example.com/xapi/'))
      .toBe('https://lrs.example.com/xapi/statements')
  })

  it('is idempotent when the URL already ends in /statements', () => {
    expect(joinStatementUrl('https://lrs.example.com/xapi/statements'))
      .toBe('https://lrs.example.com/xapi/statements')
  })
})

describe('postStatement', () => {
  it('posts JSON with Basic auth and X-Experience-API-Version', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedInit = init
      return new Response('OK', { status: 200 })
    }) as unknown as typeof fetch

    const r = await postStatement(endpoint(), STATEMENT, fakeFetch)
    expect(r).toEqual({ ok: true, status: 200, body: 'OK' })
    expect(capturedUrl).toBe('https://lrs.example.com/xapi/statements')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    expect(headers['X-Experience-API-Version']).toBe('1.0.3')
    expect(headers['Authorization']).toBe(`Basic ${btoa('key:secret')}`)
    expect(capturedInit?.method).toBe('POST')
    expect(JSON.parse(String(capturedInit?.body))).toEqual(STATEMENT)
  })

  it('returns ok=false with error message on non-2xx responses', async () => {
    const fakeFetch = (async () =>
      new Response('bad credentials', { status: 401 })) as unknown as typeof fetch

    const r = await postStatement(endpoint(), STATEMENT, fakeFetch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(401)
    expect(r.body).toBe('bad credentials')
    expect(r.error).toBe('LRS returned 401')
  })

  it('returns ok=false with thrown-error message on network failure', async () => {
    const fakeFetch = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch

    const r = await postStatement(endpoint(), STATEMENT, fakeFetch)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.status).toBe(0)
    expect(r.error).toBe('ECONNREFUSED')
  })

  it('truncates very large response bodies to 4 KB', async () => {
    const huge = 'a'.repeat(8_000)
    const fakeFetch = (async () =>
      new Response(huge, { status: 200 })) as unknown as typeof fetch

    const r = await postStatement(endpoint(), STATEMENT, fakeFetch)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.body.length).toBeLessThanOrEqual(4_001)  // 4000 + ellipsis
    expect(r.body.endsWith('…')).toBe(true)
  })
})
