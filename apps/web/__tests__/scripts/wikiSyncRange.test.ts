import { describe, it, expect } from 'vitest'

// @ts-expect-error — plain .mjs helper outside the web workspace, no types
import { skipScanRange } from '../../../../scripts/lib/wikiSyncRange.mjs'

// The wiki-sync gate scanned `git log -50` for a `wiki-sync-skip:` directive —
// "the last 50 commits", not "the commits under review". So one merged commit
// carrying a legitimate one-off skip suppressed the gate for every later PR
// until it aged out of the window. Commit e14d549f did exactly that, and every
// green wiki-sync check in that period passed by skipping rather than checking.
//
// Nothing about that failure was visible: a disabled gate and a passing gate
// print the same colour. These tests pin the range so it cannot drift back.

describe('skipScanRange — the range a wiki-sync-skip may speak for', () => {
  it('scans only the PR range, never history behind the base', () => {
    expect(skipScanRange({ mergeBase: 'abc123' })).toBe('abc123..HEAD')
  })

  it('scans from an explicit --since revision', () => {
    expect(skipScanRange({ explicitSince: 'v1.2.3' })).toBe('v1.2.3..HEAD')
  })

  it('prefers --since over a merge base when both are supplied', () => {
    expect(skipScanRange({ explicitSince: 'deadbee', mergeBase: 'abc123' }))
      .toBe('deadbee..HEAD')
  })

  // Pre-commit: the message that would carry the directive is not written yet,
  // so no existing commit body speaks for this change. Scanning anything here
  // is what let an unrelated ancestor grant the skip.
  it('scans nothing in staged mode', () => {
    expect(skipScanRange({ stagedOnly: true })).toBeNull()
  })

  it('scans nothing in staged mode even if a merge base is known', () => {
    expect(skipScanRange({ stagedOnly: true, mergeBase: 'abc123' })).toBeNull()
  })

  // Fail closed. Without a merge base we cannot say what is under review, and a
  // check that exists to catch omissions should stay armed when it is unsure.
  it('scans nothing when the range cannot be established', () => {
    expect(skipScanRange({ mergeBase: null })).toBeNull()
    expect(skipScanRange({})).toBeNull()
    expect(skipScanRange()).toBeNull()
  })

  // The regression itself: no input may produce an unbounded window.
  it('never returns a range that reaches behind the base', () => {
    const inputs = [
      { mergeBase: 'abc123' },
      { explicitSince: 'v1.0.0' },
      { stagedOnly: true },
      {},
    ]
    for (const input of inputs) {
      const range = skipScanRange(input)
      if (range === null) continue
      expect(range).toMatch(/\.\.HEAD$/)
      expect(range).not.toMatch(/^-/)
    }
  })
})
