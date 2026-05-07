import { describe, it, expect } from 'vitest'
import { VERSION, COMMIT, VERSION_LINE } from '@/lib/version'
import pkg from '../../package.json'

// The semver in lib/version.ts and the one in package.json get bumped
// together at every release. If a future PR forgets to bump one, this
// test fails — pointing at the drift before it lands in production.

describe('app version', () => {
  it('VERSION matches package.json version', () => {
    expect(VERSION).toBe(pkg.version)
  })

  it('VERSION is a valid semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[\w.]+)?$/)
  })

  it('COMMIT is either 7 hex chars or "dev"', () => {
    expect(COMMIT === 'dev' || /^[0-9a-f]{7}$/.test(COMMIT)).toBe(true)
  })

  it('VERSION_LINE composes correctly', () => {
    expect(VERSION_LINE).toBe(`v${VERSION} (${COMMIT})`)
  })
})
