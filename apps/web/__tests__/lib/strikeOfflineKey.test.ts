import { beforeEach, describe, expect, it } from 'vitest'
import { createDecipheriv } from 'node:crypto'
import { deriveOfflineKey, encryptAnswerKey, type OfflineAnswerKeyPayload } from '@/lib/strike/offlineKey'

const payload: OfflineAnswerKeyPayload = {
  questions: [{ questionId: 'q1', questionType: 'multiple_choice', required: true, points: 2, correctAnswerIds: ['a2'] }],
  explanations: { q1: 'Lock out before you open the guard.' },
}

// Decrypts the way the tablet does with @noble/ciphers: ciphertext then a
// 16-byte tag in one buffer.
function decrypt(key: Buffer, enc: ReturnType<typeof encryptAnswerKey>): OfflineAnswerKeyPayload {
  const data = Buffer.from(enc.data, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(enc.iv, 'base64'))
  decipher.setAuthTag(data.subarray(data.length - 16))
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8'))
}

describe('offline answer key', () => {
  beforeEach(() => { process.env.STRIKE_OFFLINE_SECRET = 'test-offline-secret-at-least-32-characters-long' })

  it('round-trips through the layout the tablet decrypts', () => {
    const key = deriveOfflineKey('device-1', 'version-1')
    expect(decrypt(key, encryptAnswerKey(key, payload))).toEqual(payload)
  })

  it('derives the same key for the same device and version, and a different one for any other', () => {
    expect(deriveOfflineKey('device-1', 'v1').equals(deriveOfflineKey('device-1', 'v1'))).toBe(true)
    expect(deriveOfflineKey('device-1', 'v1').equals(deriveOfflineKey('device-2', 'v1'))).toBe(false)
    expect(deriveOfflineKey('device-1', 'v1').equals(deriveOfflineKey('device-1', 'v2'))).toBe(false)
    expect(deriveOfflineKey('device-1', 'v1').equals(deriveOfflineKey('user:device-1', 'v1'))).toBe(false)
  })

  it("cannot be opened with another device's key, and tampering is detected", () => {
    const enc = encryptAnswerKey(deriveOfflineKey('device-1', 'v1'), payload)
    expect(() => decrypt(deriveOfflineKey('device-2', 'v1'), enc)).toThrow()
    const tampered = { ...enc, data: Buffer.from(Buffer.from(enc.data, 'base64').map((b, i) => (i === 0 ? b ^ 1 : b))).toString('base64') }
    expect(() => decrypt(deriveOfflineKey('device-1', 'v1'), tampered)).toThrow()
  })

  it('uses a fresh iv each time, so the same key never repeats a ciphertext', () => {
    const key = deriveOfflineKey('device-1', 'v1')
    const a = encryptAnswerKey(key, payload)
    const b = encryptAnswerKey(key, payload)
    expect(a.iv).not.toBe(b.iv)
    expect(a.data).not.toBe(b.data)
  })

  it('refuses to run without a long enough server secret', () => {
    process.env.STRIKE_OFFLINE_SECRET = 'short'
    expect(() => deriveOfflineKey('d', 'v')).toThrow(/STRIKE_OFFLINE_SECRET/)
  })
})
