// Mocked-Anthropic integration tests for /api/generate-confined-space-hazards.

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  resetAiMocks, gateRejects, rateLimitBlocks,
  queueAnthropic, queueAnthropicRaw, queueAnthropicError,
  logAiInvocationMock, messagesCreateMock,
} from './_helpers'
import { POST } from '@/app/api/generate-confined-space-hazards/route'

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://x/api/generate-confined-space-hazards', {
    method:  'POST',
    headers: {
      authorization:    'Bearer t',
      'x-active-tenant': '00000000-0000-0000-0000-000000000001',
      'content-type':    'application/json',
    },
    body: JSON.stringify(body),
  })
}

const VALID_BODY = {
  space_id:       'CS-001',
  description:    'Stainless steel CIP balance tank',
  department:     'Production',
  space_type:     'tank',
  classification: 'permit-required',
}

const VALID_FIELDS = JSON.stringify({
  hazards: [
    'Residual caustic at 140-180°F from CIP cycle',
    'O2 displacement during nitrogen purge',
  ],
  isolation_measures: [
    'Drain CIP supply via rinse cycle',
    'LOTO main pump disconnect at MCC-1',
  ],
  equipment_list: [
    '4-gas monitor (O2/LEL/H2S/CO)',
    'Forced-air ventilation rated 200+ CFM',
  ],
  rescue_equipment: [
    'Tripod + winch retrieval system',
    'SCBA on attendant',
  ],
  notes: 'Verify single bottom outlet on site before entry.',
})

beforeEach(() => {
  resetAiMocks()
})

describe('POST /api/generate-confined-space-hazards — gate', () => {
  it('returns gate status on auth failure', async () => {
    gateRejects(401, 'Invalid session')
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('returns 429 when rate-limited', async () => {
    rateLimitBlocks('hourly', 3600)
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(429)
  })
})

describe('POST /api/generate-confined-space-hazards — input', () => {
  it('returns 400 when required fields missing', async () => {
    const res = await POST(jsonRequest({ ...VALID_BODY, space_id: '' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/generate-confined-space-hazards — happy path', () => {
  it('returns 200 with parsed hazard inventory', async () => {
    queueAnthropic(VALID_FIELDS)
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.hazards.length).toBeGreaterThan(0)
    expect(body.isolation_measures.length).toBeGreaterThan(0)
    expect(body.equipment_list.length).toBeGreaterThan(0)
    expect(body.rescue_equipment.length).toBeGreaterThan(0)
    expect(typeof body.notes).toBe('string')
  })

  it('does NOT include image content blocks (text-only after photo-AI removal)', async () => {
    queueAnthropic(VALID_FIELDS)
    await POST(jsonRequest({
      ...VALID_BODY,
      // Stale callers may still send photo URLs; the route ignores them.
      equip_photo_url:    'https://example.com/equip.jpg',
      interior_photo_url: 'https://example.com/interior.jpg',
    } as Record<string, unknown>))
    const lastCall = messagesCreateMock.mock.calls.at(-1)?.[0]
    if (!lastCall) throw new Error('messagesCreateMock was not called')
    const images = lastCall.messages[0].content.filter(c => c.type === 'image')
    expect(images).toHaveLength(0)
  })

  it('forwards known_hazards in the user brief', async () => {
    queueAnthropic(VALID_FIELDS)
    await POST(jsonRequest({
      ...VALID_BODY,
      known_hazards: ['Confined ammonia leak history', 'Steam jacket present'],
    }))
    const lastCall = messagesCreateMock.mock.calls.at(-1)?.[0]
    if (!lastCall) throw new Error('messagesCreateMock was not called')
    const textBlock = lastCall.messages[0].content.find(c => c.type === 'text')
    expect(textBlock?.text).toContain('Confined ammonia leak history')
    expect(textBlock?.text).toContain('Steam jacket present')
  })

  it('logs success with surface and tokens', async () => {
    queueAnthropic(VALID_FIELDS, { input_tokens: 1500, output_tokens: 600 })
    await POST(jsonRequest(VALID_BODY))
    const successCall = logAiInvocationMock.mock.calls.find(c => c[0].status === 'success')
    expect(successCall).toBeDefined()
    expect(successCall![0].surface).toBe('generate-confined-space-hazards')
    expect(successCall![0].inputTokens).toBe(1500)
    expect(successCall![0].outputTokens).toBe(600)
  })
})

describe('POST /api/generate-confined-space-hazards — error paths', () => {
  it('returns 502 when no text block in response', async () => {
    queueAnthropicRaw({ content: [], usage: {}, stop_reason: 'end_turn' })
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(502)
  })

  it('returns 502 when hazards array is empty', async () => {
    queueAnthropic(JSON.stringify({
      hazards: [],
      isolation_measures: [],
      equipment_list: [],
      rescue_equipment: [],
      notes: '',
    }))
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/no hazards/i)
  })

  it('returns 429 on Anthropic.RateLimitError', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as {
      RateLimitError: new () => Error
    }
    queueAnthropicError(new Anthropic.RateLimitError())
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(429)
  })

  it('logs error on Anthropic failures', async () => {
    queueAnthropicError(new Error('network down'))
    await POST(jsonRequest(VALID_BODY))
    const errorCall = logAiInvocationMock.mock.calls.find(c => c[0].status === 'error')
    expect(errorCall).toBeDefined()
    expect(errorCall![0].surface).toBe('generate-confined-space-hazards')
  })
})
