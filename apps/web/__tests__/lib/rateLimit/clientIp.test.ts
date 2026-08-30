import { describe, it, expect } from 'vitest'
import { clientIp } from '@/lib/rateLimit/clientIp'

function req(headers: Record<string, string>): Request {
  return new Request('https://example.test/api/thing', { headers })
}

describe('clientIp', () => {
  it('prefers the platform header over anything the caller can set', () => {
    expect(
      clientIp(
        req({
          'x-vercel-forwarded-for': '203.0.113.7',
          'x-forwarded-for': '9.9.9.9, 203.0.113.7',
          'x-real-ip': '198.51.100.1',
        }),
      ),
    ).toBe('203.0.113.7')
  })

  it('falls through the header precedence in order', () => {
    expect(clientIp(req({ 'cf-connecting-ip': '203.0.113.8' }))).toBe('203.0.113.8')
    expect(clientIp(req({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
  })

  it('ignores a forged leftmost x-forwarded-for hop', () => {
    // A caller who sets the header themselves prepends their value; the proxy
    // appends the real peer. Reading position 0 would hand them a fresh
    // rate-limit bucket on every request.
    expect(clientIp(req({ 'x-forwarded-for': '9.9.9.9, 203.0.113.10' }))).toBe(
      '203.0.113.10',
    )
  })

  it('handles a single-hop x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': '203.0.113.11' }))).toBe('203.0.113.11')
  })

  it('tolerates whitespace and empty hops', () => {
    expect(clientIp(req({ 'x-forwarded-for': ' 9.9.9.9 ,  203.0.113.12 , ' }))).toBe(
      '203.0.113.12',
    )
  })

  it('falls back to a sentinel when no header identifies the caller', () => {
    expect(clientIp(req({}))).toBe('0.0.0.0')
  })
})
