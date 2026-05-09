// Constant-time string comparison.
//
// Used by every cron route's authorize() helper. Each route had its
// own copy; this single export removes the duplication and lets
// future cron routes import the right primitive instead of
// reinventing one (which is how a non-constant-time `===` slips in).

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}
