// Mocked-Anthropic integration tests for /api/validate-photo.
//
// Covers the four guards added in Phase 1 + the auth/rate-limit gate:
//   - 401 / 403 from the gate
//   - 429 from rate-limit
//   - 413 oversized image
//   - 415 unsupported media type
//   - 502 malformed JSON from model
//   - 502 unexpected response shape
//   - 200 happy path (with markdown code-fence stripping)

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  resetAiMocks, gateRejects, rateLimitBlocks,
  queueAnthropic, queueAnthropicRaw, logAiInvocationMock,
} from './_helpers'
import { POST } from '@/app/api/validate-photo/route'

function buildFormData(file: { bytes: Uint8Array; type?: string; name?: string }, type = 'EQUIP') {
  const form = new FormData()
  // Cast bytes through a fresh ArrayBuffer view so jsdom's Blob accepts it
  // — Uint8Array<ArrayBufferLike> isn't assignable to BlobPart in newer libs.
  const blob = new Blob([file.bytes.buffer as ArrayBuffer], { type: file.type ?? 'image/jpeg' })
  form.append('file', blob, file.name ?? 'photo.jpg')
  form.append('type', type)
  return form
}

function multipartRequest(form: FormData): NextRequest {
  return new NextRequest('http://x/api/validate-photo', {
    method:  'POST',
    headers: { authorization: 'Bearer t', 'x-active-tenant': '00000000-0000-0000-0000-000000000001' },
    body:    form,
  })
}

beforeEach(() => {
  resetAiMocks()
})

describe('POST /api/validate-photo — auth/rate', () => {
  it('returns the gate status when auth fails', async () => {
    gateRejects(401, 'Missing bearer token')
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1, 2, 3]) })))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Missing bearer token')
  })

  it('returns 429 with retry-after when rate-limited', async () => {
    rateLimitBlocks('hourly', 3600)
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1, 2, 3]) })))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('3600')
  })
})

describe('POST /api/validate-photo — input validation', () => {
  it('returns 400 when no file is provided', async () => {
    
    const form = new FormData()
    form.append('type', 'EQUIP')
    const res = await POST(multipartRequest(form))
    expect(res.status).toBe(400)
  })

  it('returns 413 for files larger than 4 MB', async () => {
    // Stub formData() rather than actually building a 4 MB+ request body —
    // jsdom's undici Request rejects/truncates very large bodies, which
    // would mask the actual size-cap path under test.
    const fakeFile = {
      size: 5 * 1024 * 1024,
      type: 'image/jpeg',
      arrayBuffer: async () => new ArrayBuffer(0),
    }
    const fakeForm = {
      get: (k: string) => k === 'file' ? fakeFile : k === 'type' ? 'EQUIP' : null,
    }
    const req = new NextRequest('http://x/api/validate-photo', {
      method:  'POST',
      headers: { authorization: 'Bearer t', 'x-active-tenant': '00000000-0000-0000-0000-000000000001' },
    });
    (req as unknown as { formData: () => Promise<unknown> }).formData = async () => fakeForm
    const res = await POST(req)
    expect(res.status).toBe(413)
    const body = await res.json()
    expect(body.error).toMatch(/too large/i)
  })

  it('returns 415 for unsupported media types', async () => {
    
    const res = await POST(multipartRequest(buildFormData({
      bytes: new Uint8Array([1]), type: 'application/pdf', name: 'doc.pdf',
    })))
    expect(res.status).toBe(415)
    const body = await res.json()
    expect(body.error).toMatch(/unsupported image type/i)
  })

  it('accepts image/jpeg, image/png, image/webp, image/gif', async () => {
    for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
      resetAiMocks()
      queueAnthropic('{"valid": true, "reason": "ok"}')
      
      const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]), type: mime })))
      expect(res.status, `mime=${mime}`).toBe(200)
    }
  })
})

describe('POST /api/validate-photo — model output handling', () => {
  it('returns 200 + parsed body on a clean valid response', async () => {
    queueAnthropic('{"valid": true, "reason": "Industrial pump visible."}')
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ valid: true, reason: 'Industrial pump visible.' })
  })

  it('strips markdown code fences before parsing', async () => {
    queueAnthropic('```json\n{"valid": false, "reason": "blank wall"}\n```')
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.valid).toBe(false)
  })

  it('returns 502 on malformed JSON instead of 500', async () => {
    queueAnthropic('this is not JSON at all')
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/malformed/i)
  })

  it('returns 502 when shape mismatch (extra fields, wrong types)', async () => {
    queueAnthropic('{"valid": "yes", "reason": 5}')
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/unexpected output shape/i)
  })

  it('returns 502 when the response has no text block', async () => {
    queueAnthropicRaw({ content: [], usage: {}, stop_reason: 'end_turn' })
    
    const res = await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    expect(res.status).toBe(502)
  })
})

describe('POST /api/validate-photo — invocation logging', () => {
  it('logs success with token usage on a clean response', async () => {
    queueAnthropic('{"valid": true, "reason": "ok"}', { input_tokens: 1234, output_tokens: 56 })
    
    await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    expect(logAiInvocationMock).toHaveBeenCalled()
    const lastCall = logAiInvocationMock.mock.calls.at(-1)![0]
    expect(lastCall.status).toBe('success')
    expect(lastCall.surface).toBe('validate-photo')
    expect(lastCall.inputTokens).toBe(1234)
    expect(lastCall.outputTokens).toBe(56)
  })

  it('logs error when JSON parse fails', async () => {
    queueAnthropic('garbage')
    
    await POST(multipartRequest(buildFormData({ bytes: new Uint8Array([1]) })))
    const errorCalls = logAiInvocationMock.mock.calls
      .map(c => c[0])
      .filter((a: { status: string }) => a.status === 'error')
    expect(errorCalls.length).toBeGreaterThan(0)
    expect(errorCalls[0].context).toBe('json-parse-failed')
  })
})
