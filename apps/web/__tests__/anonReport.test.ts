import { describe, it, expect } from 'vitest'
import {
  generateReceiptPin,
  hashReceipt,
  isValidPinFormat,
  normalizePin,
} from '@/lib/anonReport/receipt'
import { haversineMeters, isOutsideRadius, parsePgPoint } from '@/lib/anonReport/geofence'
import { pickLocale } from '@/lib/anonReport/i18n'

describe('receipt PIN', () => {
  it('generates 6-char alphanumeric PINs from the safe alphabet', () => {
    const pin = generateReceiptPin()
    expect(pin).toHaveLength(6)
    expect(isValidPinFormat(pin)).toBe(true)
  })

  it('normalizes user input case-insensitively and ignores whitespace', () => {
    expect(normalizePin('  ab cd ef  ')).toBe('ABCDEF')
  })

  it('rejects PINs containing visually-ambiguous chars', () => {
    expect(isValidPinFormat('ABCDE0')).toBe(false) // 0 excluded
    expect(isValidPinFormat('ABCDEI')).toBe(false) // I excluded
    expect(isValidPinFormat('ABCDEL')).toBe(false) // L excluded
    expect(isValidPinFormat('ABCDE5')).toBe(true)
  })

  it('hashes (report, pin) pairs deterministically', () => {
    const a = hashReceipt('INC-001234', 'AB23CD')
    const b = hashReceipt('INC-001234', 'ab23cd ')
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })

  it('produces different hashes for different PINs against the same report', () => {
    expect(hashReceipt('INC-1', 'AB23CD')).not.toBe(hashReceipt('INC-1', 'EF45GH'))
  })
})

describe('geofence', () => {
  it('haversine matches a known reference distance', () => {
    // NYC to LA — ~3936 km. Loose tolerance for floating point.
    const d = haversineMeters({ lat: 40.7128, lng: -74.0060 }, { lat: 34.0522, lng: -118.2437 })
    expect(d).toBeGreaterThan(3_900_000)
    expect(d).toBeLessThan(3_980_000)
  })

  it('returns null when geofence is not in effect', () => {
    expect(isOutsideRadius(null, { lat: 0, lng: 0 }, 100)).toBeNull()
    expect(isOutsideRadius({ lat: 0, lng: 0 }, null, 100)).toBeNull()
    expect(isOutsideRadius({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }, null)).toBeNull()
  })

  it('detects inside vs outside radius', () => {
    const site  = { lat: 40.7128, lng: -74.0060 }
    const close = { lat: 40.7129, lng: -74.0061 }
    const far   = { lat: 40.8000, lng: -74.0060 }
    expect(isOutsideRadius(site, close, 100)).toBe(false)
    expect(isOutsideRadius(site, far,   100)).toBe(true)
  })

  it('parses Postgres point literals defensively', () => {
    expect(parsePgPoint('(40.7,-74.0)')).toEqual({ lat: 40.7, lng: -74.0 })
    expect(parsePgPoint(' ( 1.5 , 2.5 ) ')).toEqual({ lat: 1.5, lng: 2.5 })
    expect(parsePgPoint(null)).toBeNull()
    expect(parsePgPoint('not a point')).toBeNull()
  })
})

describe('locale resolution', () => {
  it('picks the first supported short-code in the candidate list', () => {
    expect(pickLocale(['es-MX', 'en'])).toBe('es')
    expect(pickLocale(['fr', 'en-US'])).toBe('en')
    expect(pickLocale([null, undefined, ''])).toBe('en')
  })

  it('falls back to en for unsupported locales', () => {
    expect(pickLocale(['de', 'fr', 'ja'])).toBe('en')
  })
})
