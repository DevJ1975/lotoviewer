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
// Everything below is relative to the window, so these tests keep their meaning
// if the window is ever retuned; one test pins the number itself.
const WINDOW = RELEASE_NOTE_BANNER_DAYS * DAY

const ago = (ms: number) => new Date(NOW - ms).toISOString()

describe('RELEASE_NOTE_BANNER_DAYS', () => {
  it('is four weeks', () => {
    expect(RELEASE_NOTE_BANNER_DAYS).toBe(28)
  })
})

describe('isReleaseNoteFresh', () => {
  it('shows a note published just now', () => {
    expect(isReleaseNoteFresh(ago(0), NOW)).toBe(true)
  })

  it('shows a note published a day inside the window', () => {
    expect(isReleaseNoteFresh(ago(WINDOW - DAY), NOW)).toBe(true)
  })

  it('hides a note published a day past the window', () => {
    expect(isReleaseNoteFresh(ago(WINDOW + DAY), NOW)).toBe(false)
  })

  // The exact boundary, both sides — the instant the window elapses the
  // banner is done.
  it('is fresh one minute before the boundary and stale one minute after', () => {
    expect(isReleaseNoteFresh(ago(WINDOW - 60_000), NOW)).toBe(true)
    expect(isReleaseNoteFresh(ago(WINDOW + 60_000), NOW)).toBe(false)
  })

  it('treats exactly one full window as expired', () => {
    expect(isReleaseNoteFresh(ago(WINDOW), NOW)).toBe(false)
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
    expect(releaseNoteCutoffIso(NOW)).toBe(new Date(NOW - WINDOW).toISOString())
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
