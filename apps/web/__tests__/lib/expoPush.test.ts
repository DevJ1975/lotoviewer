import { describe, it, expect } from 'vitest'

import {
  buildExpoMessages,
  chunk,
  EXPO_CHUNK_SIZE,
  isExpoPushToken,
  staleTokensFromTickets,
} from '@/lib/notifications/expoPush'

const GOOD = 'ExponentPushToken[abc123_-XYZ]'

describe('isExpoPushToken', () => {
  it('accepts both token prefixes', () => {
    expect(isExpoPushToken(GOOD)).toBe(true)
    expect(isExpoPushToken('ExpoPushToken[abc]')).toBe(true)
  })

  it.each(['', 'abc', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'https://fcm.googleapis.com/x'])(
    'rejects %j',
    value => expect(isExpoPushToken(value)).toBe(false),
  )
})

describe('buildExpoMessages', () => {
  it('drops malformed tokens and forwards only url + tag as data', () => {
    const messages = buildExpoMessages([GOOD, 'nope'], {
      title: 'Permit expiring', body: 'CS-12 expires in 30 min', url: '/confined-spaces/1', tag: 'permit:1',
    })
    expect(messages).toEqual([{
      to: GOOD,
      title: 'Permit expiring',
      body: 'CS-12 expires in 30 min',
      sound: 'default',
      data: { url: '/confined-spaces/1', tag: 'permit:1' },
    }])
  })
})

describe('chunk', () => {
  it('splits at the Expo batch limit', () => {
    const items = Array.from({ length: EXPO_CHUNK_SIZE * 2 + 1 }, (_, i) => i)
    expect(chunk(items, EXPO_CHUNK_SIZE).map(c => c.length)).toEqual([100, 100, 1])
  })

  it('returns no batches for no items', () => {
    expect(chunk([], EXPO_CHUNK_SIZE)).toEqual([])
  })
})

describe('staleTokensFromTickets', () => {
  it('returns only DeviceNotRegistered tokens, matched by position', () => {
    const tokens = ['t0', 't1', 't2', 't3']
    expect(staleTokensFromTickets(tokens, [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
      { status: 'error', details: { error: 'MessageRateExceeded' } },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ])).toEqual(['t1', 't3'])
  })

  it('ignores tickets beyond the token list', () => {
    expect(staleTokensFromTickets(['t0'], [
      { status: 'ok' },
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ])).toEqual([])
  })
})
