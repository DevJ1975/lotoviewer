// Mocked-Anthropic integration tests for /api/generate-loto-steps.
//
// Uses Anthropic structured outputs (json_schema) — happy path returns
// a text block whose content is JSON matching STEPS_SCHEMA.

import { describe, it, expect, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import {
  resetAiMocks, gateRejects, rateLimitBlocks,
  queueAnthropic, queueAnthropicRaw, queueAnthropicError,
  logAiInvocationMock, messagesCreateMock,
} from './_helpers'
import { POST } from '@/app/api/generate-loto-steps/route'

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://x/api/generate-loto-steps', {
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
  equipment_id: 'EQ-001',
  description:  'Industrial mixer with 480V three-phase supply',
  department:   'Production',
}

const VALID_STEPS = JSON.stringify({
  steps: [
    {
      energy_type: 'E',
      tag_description: 'Main 480V disconnect — Panel PDB-5',
      isolation_procedure: 'Open disconnect, lock with padlock and tag.',
      method_of_verification: 'Verify with calibrated voltmeter at motor terminals.',
    },
  ],
})

beforeEach(() => {
  resetAiMocks()
})

describe('POST /api/generate-loto-steps — gate', () => {
  it('returns gate status when auth fails', async () => {
    gateRejects(403, 'Not a member of this tenant')
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(403)
  })

  it('returns 429 when rate-limited', async () => {
    rateLimitBlocks('daily', 86400)
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('86400')
  })
})

describe('POST /api/generate-loto-steps — input validation', () => {
  it('returns 400 when equipment_id is missing', async () => {
    const res = await POST(jsonRequest({ ...VALID_BODY, equipment_id: '' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when description is missing', async () => {
    const res = await POST(jsonRequest({ ...VALID_BODY, description: '' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/generate-loto-steps — Anthropic happy path', () => {
  it('returns 200 + parsed steps', async () => {
    queueAnthropic(VALID_STEPS)
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.steps).toHaveLength(1)
    expect(body.steps[0].energy_type).toBe('E')
  })

  it('passes equip_photo_url through as image content block', async () => {
    queueAnthropic(VALID_STEPS)
    await POST(jsonRequest({
      ...VALID_BODY,
      equip_photo_url: 'https://example.com/equip.jpg',
    }))
    const lastCall = messagesCreateMock.mock.calls.at(-1)?.[0]
    if (!lastCall) throw new Error('messagesCreateMock was not called')
    const userContent = lastCall.messages[0].content
    const imageBlock = userContent.find(c => c.type === 'image')
    expect(imageBlock?.source?.url).toBe('https://example.com/equip.jpg')
  })

  it('logs success with token usage', async () => {
    queueAnthropic(VALID_STEPS, { input_tokens: 800, output_tokens: 400 })
    await POST(jsonRequest(VALID_BODY))
    const successCall = logAiInvocationMock.mock.calls.find(c => c[0].status === 'success')
    expect(successCall).toBeDefined()
    expect(successCall![0].surface).toBe('generate-loto-steps')
    expect(successCall![0].inputTokens).toBe(800)
    expect(successCall![0].outputTokens).toBe(400)
  })
})

describe('POST /api/generate-loto-steps — Anthropic error paths', () => {
  it('returns 502 when no text block in response', async () => {
    queueAnthropicRaw({ content: [], usage: {}, stop_reason: 'end_turn' })
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(502)
  })

  it('returns 502 when steps array is empty', async () => {
    queueAnthropic(JSON.stringify({ steps: [] }))
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(502)
    const body = await res.json()
    expect(body.error).toMatch(/no steps/i)
  })

  it('returns 429 on Anthropic.RateLimitError', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as {
      RateLimitError: new () => Error
    }
    queueAnthropicError(new Anthropic.RateLimitError())
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(429)
  })

  it('returns 502 on Anthropic.APIError', async () => {
    const Anthropic = (await import('@anthropic-ai/sdk')).default as unknown as {
      APIError: new () => Error & { status: number }
    }
    const e = new Anthropic.APIError()
    e.status = 503
    queueAnthropicError(e)
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(502)
  })

  it('returns 500 on unrecognized errors', async () => {
    queueAnthropicError(new Error('boom'))
    const res = await POST(jsonRequest(VALID_BODY))
    expect(res.status).toBe(500)
  })

  it('logs error on Anthropic failures', async () => {
    queueAnthropicError(new Error('boom'))
    await POST(jsonRequest(VALID_BODY))
    const errorCall = logAiInvocationMock.mock.calls.find(c => c[0].status === 'error')
    expect(errorCall).toBeDefined()
    expect(errorCall![0].surface).toBe('generate-loto-steps')
  })
})
