import { describe, it, expect } from 'vitest'
import { computePhotoStatus, computePhotoStatusFromUrls, computePhotoStatusFromEquipment } from '@/lib/photoStatus'

// ── computePhotoStatus (boolean API) ────────────────────────────────────────

describe('computePhotoStatus', () => {
  it('complete when both photos present', () => {
    expect(computePhotoStatus(true, true)).toBe('complete')
  })
  it('partial when only equipment photo present', () => {
    expect(computePhotoStatus(true, false)).toBe('partial')
  })
  it('partial when only ISO photo present', () => {
    expect(computePhotoStatus(false, true)).toBe('partial')
  })
  it('missing when neither photo present', () => {
    expect(computePhotoStatus(false, false)).toBe('missing')
  })
})

// ── computePhotoStatusFromUrls (URL API — ground truth) ─────────────────────

describe('computePhotoStatusFromUrls', () => {
  // ── Happy paths ─────────────────────────────────────────────────────────

  it('complete when both URLs are valid strings', () => {
    expect(computePhotoStatusFromUrls('https://cdn.example.com/equip.jpg', 'https://cdn.example.com/iso.jpg'))
      .toBe('complete')
  })

  it('partial when only equip URL is present', () => {
    expect(computePhotoStatusFromUrls('https://cdn.example.com/equip.jpg', null))
      .toBe('partial')
  })

  it('partial when only ISO URL is present', () => {
    expect(computePhotoStatusFromUrls(null, 'https://cdn.example.com/iso.jpg'))
      .toBe('partial')
  })

  it('missing when both URLs are null', () => {
    expect(computePhotoStatusFromUrls(null, null)).toBe('missing')
  })

  // ── Null / undefined edge cases ──────────────────────────────────────────

  it('missing when both URLs are undefined', () => {
    expect(computePhotoStatusFromUrls(undefined, undefined)).toBe('missing')
  })

  it('missing when equip is null and iso is undefined', () => {
    expect(computePhotoStatusFromUrls(null, undefined)).toBe('missing')
  })

  it('missing when equip is undefined and iso is null', () => {
    expect(computePhotoStatusFromUrls(undefined, null)).toBe('missing')
  })

  it('partial when equip is a valid URL and iso is undefined', () => {
    expect(computePhotoStatusFromUrls('https://example.com/photo.jpg', undefined))
      .toBe('partial')
  })

  // ── Empty / blank string edge cases ─────────────────────────────────────
  // An empty or whitespace-only string means the photo was never actually saved;
  // it must NOT be treated as "has photo".

  it('missing when both URLs are empty strings', () => {
    expect(computePhotoStatusFromUrls('', '')).toBe('missing')
  })

  it('missing when both URLs are whitespace-only', () => {
    expect(computePhotoStatusFromUrls('   ', '   ')).toBe('missing')
  })

  it('missing when equip is empty string and iso is null', () => {
    expect(computePhotoStatusFromUrls('', null)).toBe('missing')
  })

  it('missing when equip is null and iso is empty string', () => {
    expect(computePhotoStatusFromUrls(null, '')).toBe('missing')
  })

  it('partial when equip is valid and iso is empty string', () => {
    expect(computePhotoStatusFromUrls('https://example.com/equip.jpg', ''))
      .toBe('partial')
  })

  it('partial when equip is empty string and iso is valid', () => {
    expect(computePhotoStatusFromUrls('', 'https://example.com/iso.jpg'))
      .toBe('partial')
  })

  it('partial when equip is whitespace-only and iso is valid', () => {
    expect(computePhotoStatusFromUrls('   ', 'https://example.com/iso.jpg'))
      .toBe('partial')
  })

  it('partial when equip is valid and iso is whitespace-only', () => {
    expect(computePhotoStatusFromUrls('https://example.com/equip.jpg', '\t\n'))
      .toBe('partial')
  })

  // ── Boolean inconsistency scenario ──────────────────────────────────────
  // If a boolean flag says "has photo" but the URL is null, URL wins.
  // (This tests that the URL-based function is the correct authority,
  //  vs. using has_equip_photo / has_iso_photo booleans which can drift.)
  it('reflects "missing" correctly when URLs are null even if booleans would say complete', () => {
    // Simulates a row where has_equip_photo=true, has_iso_photo=true (stale booleans)
    // but both URL columns are null (e.g., photos were deleted from storage)
    expect(computePhotoStatusFromUrls(null, null)).toBe('missing')
  })

  it('reflects "complete" correctly even if booleans would say missing', () => {
    // Simulates a row where has_equip_photo=false, has_iso_photo=false (not yet updated)
    // but both URLs already exist (e.g., migrated from another system)
    expect(computePhotoStatusFromUrls('https://example.com/e.jpg', 'https://example.com/i.jpg'))
      .toBe('complete')
  })
})

// ── computePhotoStatusFromEquipment ─────────────────────────────────────────

describe('computePhotoStatusFromEquipment', () => {
  // These tests use needs_*=true (both photos required) to exercise the
  // "classic" behavior. Specs for rows where fewer photos are required
  // live in the 'with needs flags' block below.
  const bothRequired = { needs_equip_photo: true, needs_iso_photo: true } as const

  it('complete when both URL fields are set', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url: 'https://cdn.example.com/equip.jpg',
      iso_photo_url:   'https://cdn.example.com/iso.jpg',
      ...bothRequired,
    })).toBe('complete')
  })

  it('partial when only equip_photo_url is set', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url: 'https://cdn.example.com/equip.jpg',
      iso_photo_url:   null,
      ...bothRequired,
    })).toBe('partial')
  })

  it('partial when only iso_photo_url is set', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url: null,
      iso_photo_url:   'https://cdn.example.com/iso.jpg',
      ...bothRequired,
    })).toBe('partial')
  })

  it('missing when both URL fields are null', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url: null,
      iso_photo_url:   null,
      ...bothRequired,
    })).toBe('missing')
  })

  it('missing when both URL fields are empty strings', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url: '',
      iso_photo_url:   '',
      ...bothRequired,
    })).toBe('missing')
  })

  it('partial when equip URL is set and iso URL is empty string', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url: 'https://cdn.example.com/equip.jpg',
      iso_photo_url:   '',
      needs_equip_photo: true,
      needs_iso_photo:   true,
    })).toBe('partial')
  })
})

// ── needs_*_photo — required-slot aware status ──────────────────────────────
// Equipment that only needs one photo reaches "complete" as soon as that
// required photo is uploaded. The slot that isn't required shouldn't block
// the row from counting as done.

describe('computePhotoStatus with needs flags', () => {
  it('complete when only equip is required and equip is present', () => {
    expect(computePhotoStatus(true, false, /* needsEquip */ true, /* needsIso */ false))
      .toBe('complete')
  })

  it('complete when only iso is required and iso is present', () => {
    expect(computePhotoStatus(false, true, false, true)).toBe('complete')
  })

  it('complete when nothing is required even if both are missing', () => {
    expect(computePhotoStatus(false, false, false, false)).toBe('complete')
  })

  it('still partial when equip is required but missing, even if iso is present', () => {
    expect(computePhotoStatus(false, true, true, false)).toBe('partial')
  })

  it('missing when required slot is empty and no photos exist at all', () => {
    expect(computePhotoStatus(false, false, true, false)).toBe('missing')
  })

  it('defaults to needs=true (backward compat) when flags are omitted', () => {
    expect(computePhotoStatus(true, false)).toBe('partial')
    expect(computePhotoStatus(true, true)).toBe('complete')
  })
})

describe('computePhotoStatusFromUrls with needs flags', () => {
  it('complete for equip-only equipment once equip URL is set', () => {
    expect(computePhotoStatusFromUrls(
      'https://cdn.example.com/equip.jpg',
      null,
      /* needsEquip */ true,
      /* needsIso   */ false,
    )).toBe('complete')
  })

  it('complete for iso-only equipment once iso URL is set', () => {
    expect(computePhotoStatusFromUrls(null, 'https://cdn.example.com/iso.jpg', false, true))
      .toBe('complete')
  })

  it('missing for equip-only equipment while equip URL is absent', () => {
    expect(computePhotoStatusFromUrls(null, null, true, false)).toBe('missing')
  })

  it('partial when required slot is empty but the non-required slot has a photo', () => {
    // equip is required and missing; iso is NOT required but has a photo —
    // row isn't complete because required slot is still empty.
    expect(computePhotoStatusFromUrls(null, 'https://cdn.example.com/iso.jpg', true, false))
      .toBe('partial')
  })

  it('treats whitespace-only URL as empty even when the slot is required', () => {
    expect(computePhotoStatusFromUrls('   ', null, true, false)).toBe('missing')
  })
})

describe('computePhotoStatusFromEquipment with needs flags', () => {
  it('complete for equipment that only needs an equip photo and has one', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url:   'https://cdn.example.com/equip.jpg',
      iso_photo_url:     null,
      needs_equip_photo: true,
      needs_iso_photo:   false,
    })).toBe('complete')
  })

  it('complete for equipment that needs no photos at all', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url:   null,
      iso_photo_url:     null,
      needs_equip_photo: false,
      needs_iso_photo:   false,
    })).toBe('complete')
  })

  it('missing for equip-only equipment when equip URL is null', () => {
    expect(computePhotoStatusFromEquipment({
      equip_photo_url:   null,
      iso_photo_url:     null,
      needs_equip_photo: true,
      needs_iso_photo:   false,
    })).toBe('missing')
  })
})
