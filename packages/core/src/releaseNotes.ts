// Release-note banner freshness — pure helpers, no DB, no React.
//
// The banner announces a release to every signed-in user. It goes away when
// either of two things happens first:
//
//   1. the user dismisses it (a seen-stamp in localStorage, keyed on note id), or
//   2. the note ages past RELEASE_NOTE_BANNER_DAYS.
//
// Why the second rule exists: dismissal alone leaves a note on screen forever
// for anyone who never clicked the X. A note published months ago was still
// showing at the top of the dashboard — an announcement nobody can stop
// reading is no longer an announcement, it's furniture, and it trains people
// to ignore the banner entirely.
//
// The window is anchored to `published_at`, NOT to when a given user first
// saw it. A per-user timer would mean someone who signs in after a month
// still gets a month-old announcement presented as news, which is exactly the
// behaviour being fixed. Anchoring to publication also makes the rule
// server-enforceable and identical for everyone.
//
// The clock is passed in rather than read, so this is deterministic in tests.

/** How long a published note keeps showing in the banner. */
export const RELEASE_NOTE_BANNER_DAYS = 7

const DAY_MS = 86_400_000

/**
 * Whether a note is still inside its banner window.
 *
 * An unparseable or absent timestamp returns false — hiding the banner. That
 * is the safe direction: the banner is informational, so failing closed costs
 * a missed announcement, while failing open could pin a malformed row on
 * screen permanently with no way to age it out.
 */
export function isReleaseNoteFresh(
  publishedAt: string | null | undefined,
  nowMs: number,
  windowDays: number = RELEASE_NOTE_BANNER_DAYS,
): boolean {
  if (!publishedAt) return false
  const publishedMs = Date.parse(publishedAt)
  if (Number.isNaN(publishedMs)) return false
  // A note published slightly in the future (clock skew between the DB and
  // the browser) is fresh, not stale — `elapsed` simply goes negative.
  const elapsed = nowMs - publishedMs
  return elapsed < windowDays * DAY_MS
}

/**
 * The oldest `published_at` still worth returning, as an ISO string — for the
 * API to push the window into SQL instead of fetching a stale row and
 * discarding it.
 */
export function releaseNoteCutoffIso(
  nowMs: number,
  windowDays: number = RELEASE_NOTE_BANNER_DAYS,
): string {
  return new Date(nowMs - windowDays * DAY_MS).toISOString()
}
