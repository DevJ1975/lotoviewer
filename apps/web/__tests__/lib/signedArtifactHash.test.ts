import { describe, it, expect } from 'vitest'
import { sha256Hex } from '@soteria/core/signedArtifactHash'

// Known SHA-256 fixtures sourced from RFC test vectors / openssl:
//   echo -n "" | openssl dgst -sha256
//   echo -n "abc" | openssl dgst -sha256
// These are the canonical reference outputs — if our helper drifts,
// every signed artifact in the field becomes unverifiable, so pinning
// against these vectors is the contract.

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const ABC_SHA256   = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('sha256Hex', () => {
  it('returns the SHA-256 of empty input', async () => {
    const hex = await sha256Hex(new Uint8Array(0))
    expect(hex).toBe(EMPTY_SHA256)
  })

  it('returns a stable hash for a single byte', async () => {
    // SHA-256 of a single 0x00 byte:
    //   6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d
    const hex = await sha256Hex(new Uint8Array([0x00]))
    expect(hex).toBe('6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d')
  })

  it('matches the "abc" RFC test vector', async () => {
    const bytes = new TextEncoder().encode('abc')
    const hex = await sha256Hex(bytes)
    expect(hex).toBe(ABC_SHA256)
  })

  it('is deterministic — same bytes produce same hash', async () => {
    const a = await sha256Hex(new TextEncoder().encode('soteria'))
    const b = await sha256Hex(new TextEncoder().encode('soteria'))
    expect(a).toBe(b)
  })

  it('differentiates by content (one bit flip → different digest)', async () => {
    const a = await sha256Hex(new TextEncoder().encode('soteria'))
    const b = await sha256Hex(new TextEncoder().encode('Soteria'))
    expect(a).not.toBe(b)
  })

  it('returns 64 lowercase hex chars (well-formed digest)', async () => {
    const hex = await sha256Hex(new TextEncoder().encode('hello world'))
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes a sliced Uint8Array view of a larger buffer', async () => {
    // Defensive: a Uint8Array can be a view over a larger ArrayBuffer.
    // sha256Hex must hash only the visible region, not the whole buffer.
    const big = new Uint8Array([0xff, 0xff, 0x61, 0x62, 0x63, 0xff, 0xff])
    const view = big.subarray(2, 5)         // ['a', 'b', 'c']
    const hex = await sha256Hex(view)
    expect(hex).toBe(ABC_SHA256)
  })

  it('handles a "very large" input (1 MB of zeros)', async () => {
    // 1 MB. Streaming or single-shot, the helper must produce a stable
    // hash. The expected value is openssl-verified:
    //   head -c 1048576 < /dev/zero | openssl dgst -sha256
    const oneMb = new Uint8Array(1024 * 1024)
    const hex = await sha256Hex(oneMb)
    expect(hex).toBe('30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58')
  })

  it('produces a different hash for a 1-byte-prefixed copy', async () => {
    const base = new TextEncoder().encode('abc')
    const prefixed = new Uint8Array(base.length + 1)
    prefixed.set(base, 1)                   // [0x00, 'a', 'b', 'c']
    const a = await sha256Hex(base)
    const b = await sha256Hex(prefixed)
    expect(a).not.toBe(b)
  })
})
