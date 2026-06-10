import { createSign } from 'node:crypto'

// Cloudflare Stream client for STRIKE video delivery. All uploads are
// created with `requireSignedURLs: true`, so nothing on Stream plays
// without a token minted here. Playback tokens are signed locally with
// the account's Stream RSA signing key — no Cloudflare API call per view.
//
// Env (all server-only; absence means Stream delivery is not configured
// and callers should fall back / refuse with a clear error):
//   CLOUDFLARE_ACCOUNT_ID              account that owns the Stream videos
//   CLOUDFLARE_STREAM_API_TOKEN        API token with Stream edit permission
//   CLOUDFLARE_STREAM_SIGNING_KEY_ID   `id` from POST /stream/keys
//   CLOUDFLARE_STREAM_SIGNING_KEY_PEM  `pem` from POST /stream/keys
//                                      (base64-encoded PEM, or raw PEM)
//   CLOUDFLARE_STREAM_CUSTOMER_DOMAIN  e.g. customer-xxxx.cloudflarestream.com

const API_BASE = 'https://api.cloudflare.com/client/v4'

export interface CloudflareStreamConfig {
  accountId: string
  apiToken: string
  signingKeyId: string
  signingKeyPem: string
  customerDomain: string
}

export function getCloudflareStreamConfig(): CloudflareStreamConfig | null {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_STREAM_API_TOKEN
  const signingKeyId = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID
  const rawPem = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_PEM
  const customerDomain = process.env.CLOUDFLARE_STREAM_CUSTOMER_DOMAIN
  if (!accountId || !apiToken || !signingKeyId || !rawPem || !customerDomain) return null

  return { accountId, apiToken, signingKeyId, signingKeyPem: decodePem(rawPem), customerDomain }
}

// Cloudflare returns the signing key PEM base64-encoded; raw PEM is also
// accepted so a key pasted straight from a file still works.
function decodePem(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('-----BEGIN')) return trimmed
  return Buffer.from(trimmed, 'base64').toString('utf8')
}

export interface DirectUpload {
  uploadURL: string
  uid: string
}

export async function createDirectUpload(
  config: CloudflareStreamConfig,
  opts: { maxDurationSeconds: number; meta?: Record<string, string> },
): Promise<DirectUpload> {
  const result = await cfFetch<DirectUpload>(config, 'POST', '/stream/direct_upload', {
    maxDurationSeconds: opts.maxDurationSeconds,
    requireSignedURLs: true,
    meta: opts.meta ?? {},
  })
  return { uploadURL: result.uploadURL, uid: result.uid }
}

export interface StreamVideoStatus {
  uid: string
  ready: boolean
  durationSeconds: number | null
  state: string | null
  size: number | null
}

export async function getVideoStatus(
  config: CloudflareStreamConfig,
  uid: string,
): Promise<StreamVideoStatus> {
  const result = await cfFetch<{
    uid: string
    readyToStream?: boolean
    duration?: number
    size?: number
    status?: { state?: string }
  }>(config, 'GET', `/stream/${encodeURIComponent(uid)}`)
  return {
    uid: result.uid,
    ready: result.readyToStream === true,
    // Stream reports -1 until transcoding determines the duration.
    durationSeconds: typeof result.duration === 'number' && result.duration > 0
      ? Math.round(result.duration)
      : null,
    state: result.status?.state ?? null,
    size: typeof result.size === 'number' ? result.size : null,
  }
}

export async function copyFromUrl(
  config: CloudflareStreamConfig,
  opts: { url: string; meta?: Record<string, string> },
): Promise<{ uid: string }> {
  const result = await cfFetch<{ uid: string }>(config, 'POST', '/stream/copy', {
    url: opts.url,
    requireSignedURLs: true,
    meta: opts.meta ?? {},
  })
  return { uid: result.uid }
}

// Short-lived playback JWT (RS256), verified at Cloudflare's edge.
// `downloadable: false` keeps the MP4 download endpoint disabled even
// for valid tokens.
export function signPlaybackToken(
  config: CloudflareStreamConfig,
  uid: string,
  ttlSeconds: number,
): { token: string; expiresAt: string } {
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + ttlSeconds
  const header = base64UrlJson({ alg: 'RS256', kid: config.signingKeyId, type: 'JWT' })
  const payload = base64UrlJson({
    sub: uid,
    kid: config.signingKeyId,
    exp: expiresAtEpoch,
    downloadable: false,
  })

  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  const signature = base64Url(signer.sign(config.signingKeyPem))

  return {
    token: `${header}.${payload}.${signature}`,
    expiresAt: new Date(expiresAtEpoch * 1000).toISOString(),
  }
}

export function hlsUrl(config: CloudflareStreamConfig, token: string): string {
  return `https://${config.customerDomain}/${token}/manifest/video.m3u8`
}

async function cfFetch<T>(
  config: CloudflareStreamConfig,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_BASE}/accounts/${config.accountId}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${config.apiToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  const payload = await res.json().catch(() => null) as
    | { success?: boolean; result?: T; errors?: Array<{ message?: string }> }
    | null
  if (!res.ok || !payload?.success || payload.result === undefined) {
    const detail = payload?.errors?.map(e => e.message).filter(Boolean).join('; ')
    throw new Error(`Cloudflare Stream ${method} ${path} failed (${res.status})${detail ? `: ${detail}` : ''}`)
  }
  return payload.result
}

function base64UrlJson(value: unknown): string {
  return base64Url(Buffer.from(JSON.stringify(value), 'utf8'))
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
