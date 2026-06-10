import { generateKeyPairSync, verify as cryptoVerify } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  getCloudflareStreamConfig,
  hlsUrl,
  signPlaybackToken,
  type CloudflareStreamConfig,
} from '@/lib/strike/cloudflareStream'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIVATE_PEM = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()

const config: CloudflareStreamConfig = {
  accountId: 'acct',
  apiToken: 'token',
  signingKeyId: 'key-id-1',
  signingKeyPem: PRIVATE_PEM,
  customerDomain: 'customer-test.cloudflarestream.com',
}

const STREAM_UID = 'b'.repeat(32)

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
}

describe('signPlaybackToken', () => {
  it('mints a short-lived RS256 JWT with downloads disabled', () => {
    const before = Math.floor(Date.now() / 1000)
    const { token, expiresAt } = signPlaybackToken(config, STREAM_UID, 600)

    const [headerB64, payloadB64, signatureB64] = token.split('.')
    const header = decodeSegment(headerB64)
    const payload = decodeSegment(payloadB64)

    expect(header).toMatchObject({ alg: 'RS256', kid: 'key-id-1' })
    expect(payload).toMatchObject({ sub: STREAM_UID, kid: 'key-id-1', downloadable: false })
    expect(payload.exp).toBeGreaterThanOrEqual(before + 600)
    expect(payload.exp).toBeLessThanOrEqual(before + 602)
    expect(Date.parse(expiresAt)).toBe((payload.exp as number) * 1000)

    const signature = Buffer.from(signatureB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
    const verified = cryptoVerify(
      'RSA-SHA256',
      Buffer.from(`${headerB64}.${payloadB64}`),
      publicKey,
      signature,
    )
    expect(verified).toBe(true)
  })
})

describe('hlsUrl', () => {
  it('builds the customer-domain manifest URL around the token', () => {
    expect(hlsUrl(config, 'abc.def.ghi'))
      .toBe('https://customer-test.cloudflarestream.com/abc.def.ghi/manifest/video.m3u8')
  })
})

describe('getCloudflareStreamConfig', () => {
  const ENV_KEYS = [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_STREAM_API_TOKEN',
    'CLOUDFLARE_STREAM_SIGNING_KEY_ID',
    'CLOUDFLARE_STREAM_SIGNING_KEY_PEM',
    'CLOUDFLARE_STREAM_CUSTOMER_DOMAIN',
  ] as const

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key]
  })

  function setAllEnv() {
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acct'
    process.env.CLOUDFLARE_STREAM_API_TOKEN = 'token'
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID = 'key-id-1'
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = Buffer.from(PRIVATE_PEM, 'utf8').toString('base64')
    process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN = 'customer-test.cloudflarestream.com'
  }

  it('returns null while any variable is missing', () => {
    expect(getCloudflareStreamConfig()).toBeNull()
    setAllEnv()
    delete process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM
    expect(getCloudflareStreamConfig()).toBeNull()
  })

  it('decodes the base64-encoded PEM Cloudflare hands out', () => {
    setAllEnv()
    expect(getCloudflareStreamConfig()?.signingKeyPem).toBe(PRIVATE_PEM)
  })

  it('accepts a raw PEM as-is', () => {
    setAllEnv()
    process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM = PRIVATE_PEM
    expect(getCloudflareStreamConfig()?.signingKeyPem).toBe(PRIVATE_PEM.trim())
  })
})
