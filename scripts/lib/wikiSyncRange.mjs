// Which commits may carry a `wiki-sync-skip:` directive for the check that is
// currently running.
//
// This exists because getting it wrong is silent. The scan used to be a fixed
// `git log -50` window off HEAD, which is not the set of commits under review —
// it is "the last 50 commits, whoever wrote them". One merged commit carrying a
// legitimate one-off skip therefore suppressed the gate for every subsequent PR
// until it fell out of the window. That happened: `e14d549f` disabled wiki-sync
// repo-wide for weeks, and every green check in that period passed by skipping
// rather than by checking.
//
// Split out from check-wiki-sync.mjs so it can be tested directly. Importing
// the script itself would run it.

/**
 * @param {{ stagedOnly?: boolean, explicitSince?: string|null, mergeBase?: string|null }} mode
 * @returns {string|null} a `git log` range, or null when no commit body applies
 */
export function skipScanRange({ stagedOnly = false, explicitSince = null, mergeBase = null } = {}) {
  // Pre-commit: the message that would carry the directive has not been written
  // yet, so no existing commit body speaks for this change. Scanning history
  // here is what let an unrelated ancestor grant the skip. Use WIKI_SYNC_SKIP=1
  // for a deliberate local bypass instead.
  if (stagedOnly) return null

  if (explicitSince) return `${explicitSince}..HEAD`

  // No merge-base means we could not establish what is under review (shallow
  // clone with no fallback). Returning null keeps the gate armed — failing
  // closed is right for a check whose whole purpose is to catch omissions.
  if (mergeBase) return `${mergeBase}..HEAD`

  return null
}
