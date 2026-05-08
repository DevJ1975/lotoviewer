import { describe, it, expect } from 'vitest'
import { isHostAllowed } from '@/lib/chemicalSdsFetch'

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
