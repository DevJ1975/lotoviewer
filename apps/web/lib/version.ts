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
//   5. Tag the merge commit once it lands on main:
//        git tag -a v<version> <sha> -m "v<version>" && git push origin v<version>
//
// Step 5 is here because it was missing, and following the other four
// perfectly still produced no tag: v1.9.0 through v1.17.0 all shipped
// untagged, so `git describe` and "what's deployed?" had nothing to answer
// with. Tags are cheap; reconstructing which commit was v1.13.0 a year later
// is not.
//
// (v1.12.0 and v1.14.0 were never released — VERSION never held either value.
// The sequence skips them; that is not a gap in the tags.)

export const VERSION = '1.17.0'

const COMMIT_RAW = process.env.NEXT_PUBLIC_COMMIT_SHA
                ?? process.env.VERCEL_GIT_COMMIT_SHA
                ?? ''
export const COMMIT = COMMIT_RAW ? COMMIT_RAW.slice(0, 7) : 'dev'

export const VERSION_LINE = `v${VERSION} (${COMMIT})`
