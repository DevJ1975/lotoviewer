import { describe, it, expect } from 'vitest'
import {
  parseInboundEvent,
  signHmac,
  verifyHmacSignature,
  constantTimeEqual,
} from '@soteria/core/cmmsSync'

const VALID_PAYLOAD = {
  event_type:    'work_order.opened',
  work_order_id: 'WO-2026-0001',
  equipment_id:  'BAKE-OVEN-3',
  status:        'open',
  occurred_at:   '2026-05-15T12:00:00.000Z',
  notes:         'Preventive maintenance — annual inspection',
}

describe('parseInboundEvent', () => {
  it('parses a complete canonical payload', () => {
    const result = parseInboundEvent(VALID_PAYLOAD)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event.event_type).toBe('work_order.opened')
    expect(result.event.work_order_id).toBe('WO-2026-0001')
    expect(result.event.equipment_id).toBe('BAKE-OVEN-3')
    expect(result.event.status).toBe('open')
    expect(result.event.occurred_at).toBe('2026-05-15T12:00:00.000Z')
    expect(result.event.extra).toEqual({ notes: 'Preventive maintenance — annual inspection' })
  })

  it('lifts unknown fields into extra, removing the validated ones', () => {
    const result = parseInboundEvent({
      ...VALID_PAYLOAD,
      maximo_internal_ref: 'X-9988',
      priority: 'high',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event.extra).toEqual({
      notes: 'Preventive maintenance — annual inspection',
      maximo_internal_ref: 'X-9988',
      priority: 'high',
    })
    expect(result.event.extra).not.toHaveProperty('event_type')
  })

  it('treats missing occurred_at as null (cron substitutes receive time)', () => {
    const { occurred_at, ...rest } = VALID_PAYLOAD
    void occurred_at
    const result = parseInboundEvent(rest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.event.occurred_at).toBeNull()
  })

  it('rejects an unknown event_type', () => {
    const result = parseInboundEvent({ ...VALID_PAYLOAD, event_type: 'nope' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'event_type')).toBe(true)
  })

  it('rejects when work_order_id is empty', () => {
    const result = parseInboundEvent({ ...VALID_PAYLOAD, work_order_id: '   ' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'work_order_id')).toBe(true)
  })

  it('rejects when equipment_id is missing', () => {
    const { equipment_id, ...rest } = VALID_PAYLOAD
    void equipment_id
    const result = parseInboundEvent(rest)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'equipment_id')).toBe(true)
  })

  it('rejects non-object payloads', () => {
    expect(parseInboundEvent(null).ok).toBe(false)
    expect(parseInboundEvent('string').ok).toBe(false)
    expect(parseInboundEvent([]).ok).toBe(false)
  })
})

describe('signHmac', () => {
  it('returns a sha256= prefixed lowercase-hex MAC of 64 chars', async () => {
    const sig = await signHmac('secret', 'hello world')
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it('is deterministic — same secret + body → same signature', async () => {
    const a = await signHmac('secret', '{"event_type":"work_order.opened"}')
    const b = await signHmac('secret', '{"event_type":"work_order.opened"}')
    expect(a).toBe(b)
  })

  it('differs when the secret changes', async () => {
    const a = await signHmac('secret-a', 'body')
    const b = await signHmac('secret-b', 'body')
    expect(a).not.toBe(b)
  })

  it('differs when the body changes (one-byte flip)', async () => {
    const a = await signHmac('secret', 'body')
    const b = await signHmac('secret', 'bodY')
    expect(a).not.toBe(b)
  })

  it('matches the RFC 4231 SHA-256 test vector', async () => {
    // RFC 4231 §4.2 — key="Jefe", data="what do ya want for nothing?"
    const sig = await signHmac('Jefe', 'what do ya want for nothing?')
    expect(sig).toBe('sha256=5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })
})

describe('verifyHmacSignature', () => {
  it('accepts a signature produced by signHmac', async () => {
    const body = JSON.stringify(VALID_PAYLOAD)
    const sig = await signHmac('topsecret-min16chars', body)
    expect(await verifyHmacSignature('topsecret-min16chars', body, sig)).toBe(true)
  })

  it('rejects a tampered body', async () => {
    const body = JSON.stringify(VALID_PAYLOAD)
    const sig = await signHmac('topsecret-min16chars', body)
    const tampered = body.replace('open', 'closed')
    expect(await verifyHmacSignature('topsecret-min16chars', tampered, sig)).toBe(false)
  })

  it('rejects a signature produced with the wrong secret', async () => {
    const body = 'hello'
    const sig = await signHmac('wrong-key', body)
    expect(await verifyHmacSignature('right-key', body, sig)).toBe(false)
  })

  it('rejects a missing or malformed header', async () => {
    expect(await verifyHmacSignature('secret', 'body', null)).toBe(false)
    expect(await verifyHmacSignature('secret', 'body', undefined)).toBe(false)
    expect(await verifyHmacSignature('secret', 'body', 'no-prefix')).toBe(false)
    expect(await verifyHmacSignature('secret', 'body', 'sha256=zzzz')).toBe(false)
  })
})

describe('constantTimeEqual', () => {
  it('returns true on equal strings', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
  })
  it('returns false on different strings of equal length', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
  })
  it('returns false on different lengths', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
  })
})
