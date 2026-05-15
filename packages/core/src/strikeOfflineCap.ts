// Pure helpers for the STRIKE offline video cache. Decides which cached
// entries to evict so the device respects the user-tunable cap. Kept
// platform-independent so we can unit-test without touching IndexedDB or
// the service worker.

export interface StrikeOfflineEntry {
  path: string
  sizeBytes: number
  lastUsedAt: number
}

export interface StrikeEvictionInput {
  capBytes: number
  entries: StrikeOfflineEntry[]
}

export interface StrikeEvictionDecision {
  totalBytes: number
  capBytes: number
  evictPaths: string[]
  remainingBytes: number
}

// Returns the LRU set of paths to evict so the remaining footprint is at
// or below the cap. Entries with non-positive sizes are ignored — a
// corrupted metadata row should never block eviction of real consumers.
// If the cap is non-positive or no entries are oversize, the result is
// empty and remainingBytes equals the input total.
export function decideStrikeEvictions(input: StrikeEvictionInput): StrikeEvictionDecision {
  const cap = Number.isFinite(input.capBytes) && input.capBytes > 0 ? input.capBytes : 0
  const valid = input.entries.filter(e => e.sizeBytes > 0)
  const totalBytes = valid.reduce((sum, e) => sum + e.sizeBytes, 0)

  if (cap === 0 || totalBytes <= cap) {
    return { totalBytes, capBytes: cap, evictPaths: [], remainingBytes: totalBytes }
  }

  const ordered = valid.slice().sort((a, b) => a.lastUsedAt - b.lastUsedAt)
  const evictPaths: string[] = []
  let runningTotal = totalBytes
  for (const entry of ordered) {
    if (runningTotal <= cap) break
    evictPaths.push(entry.path)
    runningTotal -= entry.sizeBytes
  }
  return {
    totalBytes,
    capBytes: cap,
    evictPaths,
    remainingBytes: runningTotal,
  }
}
