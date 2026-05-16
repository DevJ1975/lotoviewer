import { describe, it, expect } from 'vitest'
import {
  classifyPrequal,
  daysUntilPrequalExpiry,
  type PrequalRow,
} from '@soteria/core/vendorPrequal'

const NOW = new Date('2026-05-15T00:00:00.000Z')

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString().slice(0, 10)
}

describe('classifyPrequal', () => {
  it('classifies invited as pending', () => {
    const row: PrequalRow = { status: 'invited', approval_expires_at: null }
    expect(classifyPrequal(row, NOW)).toBe('pending')
  })

  it('classifies in_progress as pending', () => {
    const row: PrequalRow = { status: 'in_progress', approval_expires_at: null }
    expect(classifyPrequal(row, NOW)).toBe('pending')
  })

  it('classifies approved with future expiry beyond 30d as approved', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: daysFromNow(180) }
    expect(classifyPrequal(row, NOW)).toBe('approved')
  })

  it('classifies approved within the 30-day window as expiring', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: daysFromNow(10) }
    expect(classifyPrequal(row, NOW)).toBe('expiring')
  })

  it('classifies approved on the 30d boundary as expiring (inclusive)', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: daysFromNow(30) }
    expect(classifyPrequal(row, NOW)).toBe('expiring')
  })

  it('classifies approved past expiry as expired', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: daysFromNow(-1) }
    expect(classifyPrequal(row, NOW)).toBe('expired')
  })

  it('classifies approved with null expiry as expired (fail-safe)', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: null }
    expect(classifyPrequal(row, NOW)).toBe('expired')
  })

  it('classifies approved with unparseable expiry as expired (fail-safe)', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: 'not-a-date' }
    expect(classifyPrequal(row, NOW)).toBe('expired')
  })

  it('classifies rejected as expired', () => {
    const row: PrequalRow = { status: 'rejected', approval_expires_at: null }
    expect(classifyPrequal(row, NOW)).toBe('expired')
  })

  it('classifies expired status as expired regardless of expiry date', () => {
    const row: PrequalRow = { status: 'expired', approval_expires_at: daysFromNow(180) }
    expect(classifyPrequal(row, NOW)).toBe('expired')
  })
})

describe('daysUntilPrequalExpiry', () => {
  it('returns the positive day count for an approved future row', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: daysFromNow(45) }
    expect(daysUntilPrequalExpiry(row, NOW)).toBe(45)
  })

  it('returns negative for an approved past-expiry row', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: daysFromNow(-10) }
    expect(daysUntilPrequalExpiry(row, NOW)).toBe(-10)
  })

  it('returns Infinity for non-approved rows', () => {
    expect(daysUntilPrequalExpiry({ status: 'invited',  approval_expires_at: null }, NOW)).toBe(Infinity)
    expect(daysUntilPrequalExpiry({ status: 'rejected', approval_expires_at: null }, NOW)).toBe(Infinity)
    expect(daysUntilPrequalExpiry({ status: 'expired',  approval_expires_at: null }, NOW)).toBe(Infinity)
  })

  it('returns Infinity on unparseable expiry (fail-safe)', () => {
    const row: PrequalRow = { status: 'approved', approval_expires_at: 'banana' }
    expect(daysUntilPrequalExpiry(row, NOW)).toBe(Infinity)
  })
})
