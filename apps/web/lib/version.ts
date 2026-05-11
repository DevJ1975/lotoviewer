// App version + build metadata.
//
// VERSION is the canonical semver maintained by hand in this file
// AND in apps/web/package.json. Bump on every meaningful release —
// matched up against a release-notes entry at /superadmin/release-notes.
//
// COMMIT is the short git SHA of the deployed commit. Vercel injects
// VERCEL_GIT_COMMIT_SHA at build time; we slice to 7 chars.
//
// VERSION_LINE is "<version> (<sha>)" — the format the footer + the
// superadmin About tile use. Falls back to "<version> (dev)" outside
// Vercel.
//
// Bumping the version:
//   1. Edit VERSION below to the new semver string
//   2. Edit apps/web/package.json to match
//   3. Author a release note at /superadmin/release-notes
//   4. Commit + push; Vercel rebuilds + redeploys

export const VERSION = '1.9.0'

const COMMIT_RAW = process.env.NEXT_PUBLIC_COMMIT_SHA
                ?? process.env.VERCEL_GIT_COMMIT_SHA
                ?? ''
export const COMMIT = COMMIT_RAW ? COMMIT_RAW.slice(0, 7) : 'dev'

export const VERSION_LINE = `v${VERSION} (${COMMIT})`
