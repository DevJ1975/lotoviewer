import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from '@/lib/push'

describe('urlBase64ToUint8Array', () => {
  it('decodes a standard base64 string', () => {
    // "hello" in base64 is "aGVsbG8=" — already standard form.
    const out = urlBase64ToUint8Array('aGVsbG8')
    expect(Array.from(out)).toEqual([104, 101, 108, 108, 111])
  })

  it('reverses url-safe base64 substitutions (- → +, _ → /)', () => {
    // Real VAPID public keys use the url-safe alphabet. Without the
    // substitution, atob would throw on '-' or '_'.
    // Encoding 'foo>?' produces 'Zm9vPj8=' in standard base64; the
    // url-safe variant replaces '+' / '/' so a synthetic test of the
    // substitution path uses '-_' explicitly.
    expect(() => urlBase64ToUint8Array('Z--_aA')).not.toThrow()
  })

  it('pads the input to a multiple of 4 chars before decoding', () => {
    // 'YQ' would normally throw without padding ('YQ==' is 'a').
    const out = urlBase64ToUint8Array('YQ')
    expect(Array.from(out)).toEqual([97])  // 'a'
  })
})
