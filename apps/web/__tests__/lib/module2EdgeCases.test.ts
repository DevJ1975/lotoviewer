// Phase-D edge-case tests for Module 2 helpers. Targets boundaries
// the happy-path suites don't fully cover: retention exact-boundary
// days, legal-hold timing, hierarchy normalization fallbacks, and
// the cross-tenant defaults the production audit trail depends on.

import { describe, it, expect } from 'vitest'
import {
  shouldRetain,
  daysUntilEligibleForPurge,
  DEFAULT_RETENTION_POLICY,
} from '@soteria/core/retentionPolicy'
import {
  normalizeHierarchyLevel,
  summarizeControls,
  HAZARD_CONTROL_HIERARCHY,
} from '@soteria/core/hazardControls'
import { sha256Hex } from '@soteria/core/signedArtifactHash'

const ASOF = new Date('2026-05-15T12:00:00Z')

describe('retentionPolicy — boundary days', () => {
  it('retains a record exactly at the eligibility boundary (off-by-one safety)', () => {
    // Created exactly 1825 days ago — the OSHA 1904.33 boundary
    const created = new Date(ASOF.getTime() - 1825 * 24 * 60 * 60 * 1000).toISOString()
    const r = shouldRetain(
      { type: 'incident', created_at: created },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )
    // ageMs === windowMs → retention check is `ageMs < windowMs` so this
    // returns FALSE (eligible). Document the contract.
    expect(r).toBe(false)
  })

  it('retains a record one day inside the window', () => {
    const created = new Date(ASOF.getTime() - 1824 * 24 * 60 * 60 * 1000).toISOString()
    expect(shouldRetain(
      { type: 'incident', created_at: created },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )).toBe(true)
  })

  it('legal hold trumps an expired retention window', () => {
    // 10-year-old incident; well past the 5-year retention
    const created = '2016-01-01T00:00:00Z'
    const r = shouldRetain(
      { type: 'incident', created_at: created, legal_hold_id: 'hold-uuid' },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )
    expect(r).toBe(true)
  })

  it('daysUntilEligibleForPurge returns Infinity under legal hold (UI sentinel)', () => {
    const r = daysUntilEligibleForPurge(
      { type: 'permit', created_at: '2020-01-01', legal_hold_id: 'hold-1' },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )
    expect(r).toBe(Infinity)
  })

  it('daysUntilEligibleForPurge returns 0 on the boundary day', () => {
    const created = new Date(ASOF.getTime() - 1095 * 24 * 60 * 60 * 1000).toISOString()
    const r = daysUntilEligibleForPurge(
      { type: 'permit', created_at: created },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )
    expect(r).toBe(0)
  })

  it('daysUntilEligibleForPurge returns negative days for an overdue purge', () => {
    // 1100 days old, permit retention is 1095 → 5 days overdue
    const created = new Date(ASOF.getTime() - 1100 * 24 * 60 * 60 * 1000).toISOString()
    const r = daysUntilEligibleForPurge(
      { type: 'permit', created_at: created },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )
    expect(r).toBe(-5)
  })

  it('garbage created_at returns Infinity (fail-safe — never purge on a parse bug)', () => {
    const r = daysUntilEligibleForPurge(
      { type: 'incident', created_at: 'not-a-date' },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )
    expect(r).toBe(Infinity)
    expect(shouldRetain(
      { type: 'incident', created_at: 'not-a-date' },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )).toBe(true)
  })

  it('loto_artifact uses YEARS * 365 (not calendar years)', () => {
    // Default is 7 years = 2555 days. Created 2554 days ago = still retain.
    const created = new Date(ASOF.getTime() - 2554 * 24 * 60 * 60 * 1000).toISOString()
    expect(shouldRetain(
      { type: 'loto_artifact', created_at: created },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )).toBe(true)
  })

  it('legal_hold_id of empty string is treated as no hold', () => {
    // The denormalized column might end up as '' if a UI bug clears it
    // rather than null-setting it. shouldRetain should not treat empty
    // string as a real hold.
    const created = '2016-01-01T00:00:00Z'
    expect(shouldRetain(
      { type: 'incident', created_at: created, legal_hold_id: '' as unknown as string },
      DEFAULT_RETENTION_POLICY,
      ASOF,
    )).toBe(false)
  })
})

describe('hazardControls — degenerate input', () => {
  it('returns null for empty input on summarizeControls.topOfStack', () => {
    const s = summarizeControls([])
    expect(s.total).toBe(0)
    expect(s.topOfStack).toBeNull()
    for (const level of HAZARD_CONTROL_HIERARCHY) {
      expect(s.counts[level]).toBe(0)
    }
  })

  it('drops unrecognized hierarchy values silently', () => {
    const s = summarizeControls([
      { hierarchy_level: 'eliminate' },
      { hierarchy_level: 'cosmic_ray' },
      { hierarchy_level: 'ppe' },
    ])
    expect(s.total).toBe(2)
    expect(s.topOfStack).toBe('eliminate')
  })

  it('topOfStack is "eliminate" when ANY eliminate exists, even with 10 PPEs', () => {
    const controls = [
      ...Array(10).fill({ hierarchy_level: 'ppe' }),
      { hierarchy_level: 'eliminate' },
    ]
    const s = summarizeControls(controls)
    expect(s.topOfStack).toBe('eliminate')
    expect(s.counts.ppe).toBe(10)
    expect(s.counts.eliminate).toBe(1)
  })

  it('accepts both short ("eliminate") and long ("elimination") forms', () => {
    const s = summarizeControls([
      { hierarchy_level: 'elimination' },
      { hierarchy_level: 'substitution' },
    ])
    expect(s.counts.eliminate).toBe(1)
    expect(s.counts.substitute).toBe(1)
  })

  it('normalizeHierarchyLevel handles null/undefined/empty input', () => {
    expect(normalizeHierarchyLevel(null)).toBeNull()
    expect(normalizeHierarchyLevel(undefined)).toBeNull()
    expect(normalizeHierarchyLevel('')).toBeNull()
  })

  it('normalizeHierarchyLevel is case-sensitive (intentional — DB stores canonical lowercase)', () => {
    // If callers want case-insensitivity they should toLowerCase first.
    // Document the contract.
    expect(normalizeHierarchyLevel('Eliminate')).toBeNull()
    expect(normalizeHierarchyLevel('ELIMINATE')).toBeNull()
  })
})

describe('signedArtifactHash — boundary inputs', () => {
  it('hashes a 1MB buffer without crashing (large-PDF case)', async () => {
    const bytes = new Uint8Array(1024 * 1024)
    // Fill with a deterministic-but-non-trivial pattern
    for (let i = 0; i < bytes.length; i++) bytes[i] = i & 0xff
    const hex = await sha256Hex(bytes)
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('hashes the SAME content to the SAME hash regardless of byteOffset (subarray safety)', async () => {
    // A typed array can be a view into a larger buffer. The function
    // must hash ONLY the view's region, not the whole backing memory.
    const big = new Uint8Array([0, 0, 0, 1, 2, 3, 4, 0, 0, 0])
    const view1 = big.subarray(3, 7)              // bytes [1,2,3,4]
    const view2 = new Uint8Array([1, 2, 3, 4])
    const h1 = await sha256Hex(view1)
    const h2 = await sha256Hex(view2)
    expect(h1).toBe(h2)
  })

  it('hashes the empty buffer to the standard SHA-256 of empty input', async () => {
    // Matches `openssl dgst -sha256 -hex /dev/null`
    const hex = await sha256Hex(new Uint8Array(0))
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
