import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deflateSync } from 'node:zlib'

// The sign-off route guards what reaches verifyAssistedAttempt; the grading
// itself is covered in __tests__/lib/strikeAssistedVerify.test.ts.

const { verifyMock } = vi.hoisted(() => ({ verifyMock: vi.fn() }))
vi.mock('@/lib/strike/gate', () => ({
  requireStrikeMember: async () => ({ ok: true, tenantId: 'tenant-1', userId: 'sup-1', userEmail: 'sup@example.com', role: 'member' }),
}))
vi.mock('@/lib/strike/assisted', () => ({ verifyAssistedAttempt: (...args: unknown[]) => verifyMock(...args) }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: 'Sam Sup' }, error: null }) }) }) }) }),
}))

import { POST } from '@/app/api/strike/assisted/verify/route'

/** A real, decodable PNG of the given size (all transparent). */
function pngDataUrl(width: number, height: number): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (buf: Buffer) => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const out = Buffer.alloc(body.length + 8)
    out.writeUInt32BE(data.length, 0)
    body.copy(out, 4)
    out.writeUInt32BE(crc(body), body.length + 4)
    return out
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  const raw = Buffer.alloc((width * 4 + 1) * height)
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
  return 'data:image/png;base64,' + png.toString('base64')
}

function post(signature: string) {
  return POST(new Request('http://x/api/strike/assisted/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attempt_id: '11111111-1111-1111-1111-111111111111', checked: [], signature_png: signature }),
  }))
}

describe('POST /api/strike/assisted/verify — the signature', () => {
  beforeEach(() => {
    verifyMock.mockReset()
    verifyMock.mockResolvedValue({ ok: true, value: { completionId: 'c1', signedAt: '2026-10-20T00:00:00Z' } })
  })

  it('accepts an image the size the sign-off pad draws', async () => {
    const res = await post(pngDataUrl(600, 160))
    expect(res.status).toBe(201)
    expect(verifyMock).toHaveBeenCalledOnce()
  })

  it.each([
    ['a 1×1 pixel', pngDataUrl(1, 1)],
    ['a thin strip', pngDataUrl(600, 4)],
    ['PNG magic bytes with no image header', 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')],
    ['nothing at all', ''],
  ])('refuses %s as a signature, before anything is recorded', async (_label, signature) => {
    const res = await post(signature)
    expect(res.status).toBe(400)
    expect(verifyMock).not.toHaveBeenCalled()
  })
})
