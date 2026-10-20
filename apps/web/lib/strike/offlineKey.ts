import { createCipheriv, createHmac, randomBytes } from 'node:crypto'
import type { StrikeQuizAnswerKey } from '@soteria/core/strike'

// The quiz answer key a tablet needs to grade offline. The online API never
// sends is_correct to a browser; an offline device has no one to ask, so the
// key travels encrypted and the device decrypts it only to grade. This is
// obfuscation, not secrecy: the decryption key sits on the same device, so a
// jailbroken tablet can read it. What bounds the damage is that the key is
// per device and per version (a revoked or rotated one is useless), and the
// server re-grades every submission, so a leaked answer key cannot forge a
// pass, only help someone pass legitimately.

/** What the device decrypts: grading inputs plus the feedback shown for a miss. */
export interface OfflineAnswerKeyPayload {
  questions: StrikeQuizAnswerKey[]
  explanations: Record<string, string>
}

export interface EncryptedAnswerKey {
  alg: 'A256GCM'
  /** base64, 12 bytes */
  iv: string
  /** base64, ciphertext followed by the 16-byte GCM tag (the layout @noble/ciphers expects) */
  data: string
}

function secret(): string {
  const value = process.env.STRIKE_OFFLINE_SECRET
  if (!value || value.length < 32) throw new Error('STRIKE_OFFLINE_SECRET must be set to at least 32 characters')
  return value
}

/**
 * The 256-bit key for one (scope, version). `scope` is the enrolled device id,
 * or `user:<id>` for a signed-in tablet, so two tablets never share a key.
 * Derived, not stored: the server can re-derive it, and rotating the secret
 * invalidates every key at once.
 */
export function deriveOfflineKey(scope: string, versionId: string): Buffer {
  return createHmac('sha256', secret()).update(`strike-offline-key|${scope}|${versionId}`).digest()
}

export function encryptAnswerKey(key: Buffer, payload: OfflineAnswerKeyPayload): EncryptedAnswerKey {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return {
    alg: 'A256GCM',
    iv: iv.toString('base64'),
    data: Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64'),
  }
}
