import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isHostAllowed, fetchSdsPdf } from '@/lib/chemicalSdsFetch'

// Mock DNS so the SSRF private-address guard is deterministic. vi.hoisted lets
// the mock factory reference `lookup` despite vi.mock being hoisted above imports.
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', () => {
  const promises = { lookup }
  return { promises, default: { promises } }
})

const ALLOW = ['sigmaaldrich.com', 'osha.gov', 'pubchem.ncbi.nlm.nih.gov']

describe('isHostAllowed', () => {
  it('accepts the bare domain', () => {
    expect(isHostAllowed('sigmaaldrich.com', ALLOW)).toBe(true)
  })
  it('accepts a subdomain (suffix-match)', () => {
    expect(isHostAllowed('www.sigmaaldrich.com', ALLOW)).toBe(true)
    expect(isHostAllowed('sds.osha.gov',         ALLOW)).toBe(true)
  })
  it('accepts deep subdomains', () => {
    expect(isHostAllowed('a.b.c.sigmaaldrich.com', ALLOW)).toBe(true)
  })
  it('rejects unrelated hosts', () => {
    expect(isHostAllowed('evil.example.com', ALLOW)).toBe(false)
    expect(isHostAllowed('localhost',        ALLOW)).toBe(false)
    expect(isHostAllowed('169.254.169.254',  ALLOW)).toBe(false)
  })
  it('rejects look-alike suffix tricks', () => {
    expect(isHostAllowed('not-sigmaaldrich.com', ALLOW)).toBe(false)
    expect(isHostAllowed('sigmaaldrich.com.evil.com', ALLOW)).toBe(false)
  })
  it('is case-insensitive on the hostname', () => {
    expect(isHostAllowed('Sigmaaldrich.COM',     ALLOW)).toBe(true)
    expect(isHostAllowed('PubChem.NCBI.NIH.GOV', ALLOW)).toBe(false) // exact suffix is pubchem.ncbi.nlm.nih.gov
    expect(isHostAllowed('PUBCHEM.NCBI.NLM.NIH.GOV', ALLOW)).toBe(true)
  })
})

describe('fetchSdsPdf — discovery-mode host gating', () => {
  beforeEach(() => { lookup.mockReset() })

  it('blocks an off-allowlist host by default (drift path) before any DNS lookup', async () => {
    const r = await fetchSdsPdf('https://evil.example.com/x.pdf')
    expect(r.outcome).toBe('allowlist_blocked')
    expect(lookup).not.toHaveBeenCalled()
  })

  it('still rejects non-https even with allowAnyHost', async () => {
    const r = await fetchSdsPdf('http://evil.example.com/x.pdf', { allowAnyHost: true })
    expect(r.outcome).toBe('invalid_scheme')
  })

  it('allowAnyHost bypasses the allowlist but the private/loopback-IP guard still fires', async () => {
    lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
    const r = await fetchSdsPdf('https://internal.corp/x.pdf', { allowAnyHost: true })
    expect(lookup).toHaveBeenCalled()                 // host gate was bypassed, DNS was consulted
    expect(r.outcome).toBe('private_address_blocked') // …and the IP guard still rejected it
  })
})
