import { describe, it, expect } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { assertNotRefused, AiRefusalError, aiErrorToResponse } from '@/lib/ai/client'

// A refused request is NOT an HTTP error: the call returns 200 with
// `stop_reason: 'refusal'` and content that is empty or truncated. Every AI
// surface reads its answer with `.find(b => b.type === 'text')`, so without an
// explicit check a refusal reads as a malformed response and the operator goes
// hunting for a bug that isn't there.

function message(over: Partial<Anthropic.Message>): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content: [{ type: 'text', text: 'ok', citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    ...over,
  } as Anthropic.Message
}

describe('assertNotRefused', () => {
  it('passes a normal completion through', () => {
    expect(() => assertNotRefused(message({}), 'loto-audit-ehs')).not.toThrow()
  })

  it.each(['end_turn', 'max_tokens', 'tool_use', 'pause_turn'] as const)(
    'does not throw on stop_reason %s',
    (stop) => {
      expect(() => assertNotRefused(message({ stop_reason: stop }), 'x')).not.toThrow()
    },
  )

  it('throws AiRefusalError on a refusal', () => {
    const res = message({ stop_reason: 'refusal', content: [] })
    expect(() => assertNotRefused(res, 'loto-audit-ehs')).toThrow(AiRefusalError)
  })

  it('names the surface and carries the category', () => {
    const res = message({ stop_reason: 'refusal', content: [] })
    ;(res as unknown as Record<string, unknown>).stop_details = {
      type: 'refusal', category: 'cyber', explanation: 'declined',
    }
    try {
      assertNotRefused(res, 'loto-audit-ehs')
      throw new Error('expected a throw')
    } catch (err) {
      expect(err).toBeInstanceOf(AiRefusalError)
      expect((err as AiRefusalError).category).toBe('cyber')
      expect((err as Error).message).toContain('loto-audit-ehs')
      expect((err as Error).message).toContain('cyber')
    }
  })

  // stop_details is documented as populated only for refusals, and is not
  // guaranteed even then — branching on it instead of stop_reason would miss
  // exactly the case this guard exists for.
  it('still throws when stop_details is absent', () => {
    const res = message({ stop_reason: 'refusal', content: [] })
    expect(() => assertNotRefused(res, 'rca-assist')).toThrow(AiRefusalError)
    try {
      assertNotRefused(res, 'rca-assist')
    } catch (err) {
      expect((err as AiRefusalError).category).toBeNull()
    }
  })

  it('throws even when the model produced partial content before refusing', () => {
    const res = message({
      stop_reason: 'refusal',
      content: [{ type: 'text', text: '{"partial":', citations: null }],
    })
    expect(() => assertNotRefused(res, 'parse-sds')).toThrow(AiRefusalError)
  })
})

describe('aiErrorToResponse — refusal branch', () => {
  it('maps a refusal to 422, not a 502', () => {
    const mapped = aiErrorToResponse(new AiRefusalError('rca-assist', 'cyber', null), 'rca-assist')
    // The upstream call succeeded and the service is healthy; only this
    // request was declined. A 502 would send an operator to the status page.
    expect(mapped.status).toBe(422)
    expect(mapped.tags.kind).toBe('refusal')
    expect(mapped.tags.refusalCategory).toBe('cyber')
  })

  it('tells the user to rephrase rather than retry', () => {
    const mapped = aiErrorToResponse(new AiRefusalError('support-chat', null, null), 'support-chat')
    expect(mapped.body.error).toMatch(/rephrase/i)
    expect(mapped.body.retryAfterSec).toBeUndefined()
    expect(mapped.tags.refusalCategory).toBe('unknown')
  })

  it('does not swallow ordinary upstream errors', () => {
    expect(aiErrorToResponse({ status: 429 }, 's').status).toBe(429)
    expect(aiErrorToResponse({ status: 503 }, 's').status).toBe(502)
  })
})
