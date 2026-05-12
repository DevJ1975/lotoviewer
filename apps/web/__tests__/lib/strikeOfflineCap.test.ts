import { describe, expect, it } from 'vitest'
import { decideStrikeEvictions } from '@soteria/core/strikeOfflineCap'

const MB = 1024 * 1024

describe('decideStrikeEvictions', () => {
  it('does nothing when usage is at or below the cap', () => {
    const decision = decideStrikeEvictions({
      capBytes: 500 * MB,
      entries: [
        { path: 'a.mp4', sizeBytes: 100 * MB, lastUsedAt: 1 },
        { path: 'b.mp4', sizeBytes: 200 * MB, lastUsedAt: 2 },
      ],
    })
    expect(decision.evictPaths).toEqual([])
    expect(decision.totalBytes).toBe(300 * MB)
    expect(decision.remainingBytes).toBe(300 * MB)
  })

  it('evicts least-recently-used entries first', () => {
    const decision = decideStrikeEvictions({
      capBytes: 250 * MB,
      entries: [
        { path: 'oldest.mp4', sizeBytes: 100 * MB, lastUsedAt: 1 },
        { path: 'middle.mp4', sizeBytes: 100 * MB, lastUsedAt: 2 },
        { path: 'newest.mp4', sizeBytes: 100 * MB, lastUsedAt: 3 },
      ],
    })
    // Total 300 MB > 250 MB cap → evict the oldest one to get to 200 MB.
    expect(decision.evictPaths).toEqual(['oldest.mp4'])
    expect(decision.remainingBytes).toBe(200 * MB)
  })

  it('evicts multiple entries when one is not enough', () => {
    const decision = decideStrikeEvictions({
      capBytes: 100 * MB,
      entries: [
        { path: 'a', sizeBytes: 80 * MB, lastUsedAt: 1 },
        { path: 'b', sizeBytes: 80 * MB, lastUsedAt: 2 },
        { path: 'c', sizeBytes: 80 * MB, lastUsedAt: 3 },
      ],
    })
    expect(decision.evictPaths).toEqual(['a', 'b'])
    expect(decision.remainingBytes).toBe(80 * MB)
  })

  it('ignores zero-sized rows so corrupt metadata does not block eviction', () => {
    const decision = decideStrikeEvictions({
      capBytes: 100 * MB,
      entries: [
        { path: 'corrupt', sizeBytes: 0, lastUsedAt: 0 },
        { path: 'real-old', sizeBytes: 80 * MB, lastUsedAt: 1 },
        { path: 'real-new', sizeBytes: 80 * MB, lastUsedAt: 2 },
      ],
    })
    expect(decision.evictPaths).toEqual(['real-old'])
    expect(decision.totalBytes).toBe(160 * MB)
  })

  it('returns an empty decision when the cap is invalid', () => {
    const decision = decideStrikeEvictions({
      capBytes: 0,
      entries: [{ path: 'a', sizeBytes: 100 * MB, lastUsedAt: 1 }],
    })
    expect(decision.evictPaths).toEqual([])
    expect(decision.capBytes).toBe(0)
  })
})
