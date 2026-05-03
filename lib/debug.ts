// Console logging gated to non-production builds. Diagnostic traces in
// shipped JS pollute users' devtools and bury the real errors that
// matter — wrap them with debug() so production stays quiet but local /
// preview / Vercel-preview deploys still get the trace.
//
// NEXT_PUBLIC_VERCEL_ENV is set automatically on Vercel:
//   'production' | 'preview' | 'development'
// Falls back to NODE_ENV when running outside Vercel (local `next dev`,
// CI). The check is a module-level constant so V8 can eliminate the
// debug calls entirely in a production build.
const ENABLED =
  process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production' &&
  process.env.NODE_ENV !== 'production'

export function debug(...args: unknown[]): void {
  if (!ENABLED) return
  // eslint-disable-next-line no-console
  console.log(...args)
}
