import { describe, it, expect } from 'vitest'
import {
  isReleaseNoteFresh,
  releaseNoteCutoffIso,
  RELEASE_NOTE_BANNER_DAYS,
} from '@soteria/core/releaseNotes'

// The banner's age rule: a note shows until it is dismissed or until it ages
// past its window, whichever comes first. These cover the second half — the
// dismissal half is a localStorage stamp in the component.

const DAY = 86_400_000
const NOW = Date.parse('2026-07-30T12:00:00Z')

const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('RELEASE_NOTE_BANNER_DAYS', () => {
  it('is one week', () => {
    expect(RELEASE_NOTE_BANNER_DAYS).toBe(7)
  })
})

describe('isReleaseNoteFresh', () => {
  it('shows a note published just now', () => {
    expect(isReleaseNoteFresh(ago(0), NOW)).toBe(true)
  })

  it('shows a note published six days ago', () => {
    expect(isReleaseNoteFresh(ago(6 * DAY), NOW)).toBe(true)
  })

  it('hides a note published eight days ago', () => {
    expect(isReleaseNoteFresh(ago(8 * DAY), NOW)).toBe(false)
  })

  // The exact boundary, both sides — a week is the window, so the instant it
  // elapses the banner is done.
  it('is fresh one minute before the boundary and stale one minute after', () => {
    expect(isReleaseNoteFresh(ago(7 * DAY - 60_000), NOW)).toBe(true)
    expect(isReleaseNoteFresh(ago(7 * DAY + 60_000), NOW)).toBe(false)
  })

  it('treats exactly seven days as expired', () => {
    expect(isReleaseNoteFresh(ago(7 * DAY), NOW)).toBe(false)
  })

  // Clock skew between the database and a browser shouldn't blank the banner.
  it('shows a note timestamped slightly in the future', () => {
    expect(isReleaseNoteFresh(new Date(NOW + 60_000).toISOString(), NOW)).toBe(true)
  })

  // Failing closed costs a missed announcement; failing open could pin a
  // malformed row on screen with no way to age it out.
  it('hides a note with an absent or unparseable timestamp', () => {
    expect(isReleaseNoteFresh(null, NOW)).toBe(false)
    expect(isReleaseNoteFresh(undefined, NOW)).toBe(false)
    expect(isReleaseNoteFresh('', NOW)).toBe(false)
    expect(isReleaseNoteFresh('not a date', NOW)).toBe(false)
  })

  it('honours a caller-supplied window', () => {
    expect(isReleaseNoteFresh(ago(10 * DAY), NOW, 14)).toBe(true)
    expect(isReleaseNoteFresh(ago(2 * DAY), NOW, 1)).toBe(false)
  })

  // The regression this rule exists for: the v1.13.0 note was still on screen
  // months after publication because dismissal was the only way out.
  it('hides a months-old note that was never dismissed', () => {
    expect(isReleaseNoteFresh(ago(90 * DAY), NOW)).toBe(false)
  })
})

describe('releaseNoteCutoffIso', () => {
  it('is exactly one window back from now', () => {
    expect(releaseNoteCutoffIso(NOW)).toBe(new Date(NOW - 7 * DAY).toISOString())
  })

  // The API filters on this and the component re-checks with
  // isReleaseNoteFresh; if they disagreed, a note could pass one and fail the
  // other, producing a banner that flickers in and out on refresh.
  it('agrees with isReleaseNoteFresh at the boundary', () => {
    const cutoff = releaseNoteCutoffIso(NOW)
    expect(isReleaseNoteFresh(cutoff, NOW)).toBe(false)
    expect(isReleaseNoteFresh(new Date(Date.parse(cutoff) + 1000).toISOString(), NOW)).toBe(true)
  })
})
