#!/usr/bin/env node
// Wiki-sync check.
//
// Fails the build if a commit (or PR diff against the base branch) touches
// a documented module's source files without also touching its wiki page.
// The manifest at apps/web/app/wiki/_lib/manifest.json declares which
// source globs each wiki page documents.
//
// Modes:
//   - default: diffs HEAD against `git merge-base HEAD <BASE>` where BASE is
//     ${WIKI_SYNC_BASE:-origin/main}. Used by CI on PRs.
//   - --staged: diffs the staging area only. Used as a pre-commit hook.
//   - --since=<rev>: diffs against an arbitrary git revision.
//
// Skip:
//   - WIKI_SYNC_SKIP=1 in the environment bypasses the check entirely.
//   - A commit body line starting with `wiki-sync-skip:` (case-insensitive)
//     also bypasses, with the reason recorded. The directive only counts when
//     it appears on a commit *under review* — the range this run is checking,
//     not an ancestor already on the base branch. A skip justifies one change;
//     letting it carry into later PRs is how the gate silently switched itself
//     off for weeks. In `--staged` mode no commit body applies at all, since
//     the message does not exist yet; use WIKI_SYNC_SKIP=1 there.
//
// The check is intentionally conservative: it asks for a wiki touch, not
// a specific edit. A bumped CURRENT_VERSION + CHANGELOG row counts. The
// goal is to make "I changed the module but forgot the docs" loud, not to
// litigate every keystroke.

import { execSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

import { skipScanRange } from './lib/wikiSyncRange.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

// ── Bypass switches ────────────────────────────────────────────────────
if (process.env.WIKI_SYNC_SKIP === '1') {
  console.log('[wiki-sync] skipped (WIKI_SYNC_SKIP=1)')
  process.exit(0)
}

// ── Argv parsing ───────────────────────────────────────────────────────
const args = process.argv.slice(2)
const stagedOnly = args.includes('--staged')
const sinceArg   = args.find(a => a.startsWith('--since='))
const explicitSince = sinceArg ? sinceArg.slice('--since='.length) : null

// ── Load manifest ──────────────────────────────────────────────────────
const manifestPath = resolve(repo, 'apps/web/app/wiki/_lib/manifest.json')
if (!existsSync(manifestPath)) {
  console.error('[wiki-sync] manifest not found at', relative(repo, manifestPath))
  process.exit(2)
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const entries = Array.isArray(manifest.entries) ? manifest.entries : []
if (entries.length === 0) {
  console.log('[wiki-sync] manifest is empty — nothing to check')
  process.exit(0)
}

// ── Compute changed files ──────────────────────────────────────────────
function git(cmd) {
  return execSync(cmd, { cwd: repo, encoding: 'utf8' }).trim()
}

let changedFiles = []
let modeLabel    = ''
let bypassReason = null
// The commits under review. Set alongside changedFiles so the skip scan and the
// diff always describe the same change — see scripts/lib/wikiSyncRange.mjs.
let mergeBase    = null

try {
  if (stagedOnly) {
    modeLabel = 'staged'
    changedFiles = git('git diff --cached --name-only').split('\n').filter(Boolean)
  } else if (explicitSince) {
    modeLabel = `since ${explicitSince}`
    changedFiles = git(`git diff --name-only ${explicitSince}...HEAD`).split('\n').filter(Boolean)
  } else {
    const base = process.env.WIKI_SYNC_BASE || 'origin/main'
    modeLabel = `vs ${base}`
    try {
      mergeBase = git(`git merge-base HEAD ${base}`)
    } catch {
      console.log(`[wiki-sync] could not resolve merge-base with ${base} (likely a shallow clone or first-commit branch); falling back to HEAD~1`)
      try { mergeBase = git('git rev-parse HEAD~1') } catch { mergeBase = null }
      if (!mergeBase) {
        // Fail closed. Falling through here left changedFiles empty, which the
        // "no changed files — OK" branch below reports as a PASS — a git
        // resolution failure silently became a green gate. wikiSyncRange.mjs
        // already states the policy: "failing closed is right for a check
        // whose whole purpose is to catch omissions."
        console.error(`[wiki-sync] could not resolve a diff range against ${base} or HEAD~1 — refusing to report a pass. Deepen the clone (fetch-depth: 0) and re-run.`)
        process.exit(2)
      }
    }
    if (mergeBase) {
      const committed   = git(`git diff --name-only ${mergeBase}...HEAD`).split('\n').filter(Boolean)
      // Union with working-tree + staged changes so a local pre-push run
      // sees the not-yet-committed wiki update the developer is about to add.
      const workingTree = git('git diff --name-only').split('\n').filter(Boolean)
      const staged      = git('git diff --cached --name-only').split('\n').filter(Boolean)
      const untracked   = git('git ls-files --others --exclude-standard').split('\n').filter(Boolean)
      changedFiles = Array.from(new Set([...committed, ...workingTree, ...staged, ...untracked]))
    }
  }
} catch (err) {
  console.error('[wiki-sync] git command failed:', err.message)
  process.exit(2)
}

// Look for `wiki-sync-skip: <reason>` at the start of a line in a commit body
// belonging to THIS change. Anchored to ^ so quoting the directive in prose
// (like this comment, or in a commit that explains how the bypass works) does
// not accidentally trip it.
//
// Scoped to the range under review rather than a fixed window: a skip is a
// statement about one change, and must not speak for anyone else's. See
// scripts/lib/wikiSyncRange.mjs for what the old window cost.
const scanRange = skipScanRange({ stagedOnly, explicitSince, mergeBase })
if (scanRange) {
  try {
    const log = git(`git log ${scanRange} --pretty=%B`)
    const m = log.match(/^[ \t]*wiki-sync-skip:\s*(\S.*)$/im)
    if (m) bypassReason = m[1].trim()
  } catch { /* ignore */ }
}

if (bypassReason) {
  console.log(`[wiki-sync] skipped via commit body (${scanRange}): "${bypassReason}"`)
  process.exit(0)
}

if (changedFiles.length === 0) {
  console.log(`[wiki-sync] no changed files (${modeLabel}) — OK`)
  process.exit(0)
}

// ── Glob matching ──────────────────────────────────────────────────────
// Minimal glob support: '**' matches any number of path segments,
// '*' matches a single segment. Sufficient for the manifest's patterns.
function globToRegExp(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*'
        i++
        if (glob[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (/[a-zA-Z0-9/_\-.]/.test(c)) {
      re += c.replace(/[.+]/g, '\\$&')
    } else {
      re += '\\' + c
    }
  }
  return new RegExp('^' + re + '$')
}

function matchAny(file, globs) {
  return globs.some(g => globToRegExp(g).test(file))
}

// ── Run the check ──────────────────────────────────────────────────────
const violations = []
const okEntries  = []

for (const entry of entries) {
  const sourceTouched = changedFiles.some(f => matchAny(f, entry.sources))
  if (!sourceTouched) continue
  const wikiTouched = changedFiles.includes(entry.wikiPage)
  if (wikiTouched) {
    okEntries.push(entry)
  } else {
    violations.push({
      module:   entry.module,
      slug:     entry.slug,
      wikiPage: entry.wikiPage,
      touched:  changedFiles.filter(f => matchAny(f, entry.sources)),
    })
  }
}

console.log(`[wiki-sync] checked ${entries.length} module(s) ${modeLabel}; ${changedFiles.length} file(s) changed`)

for (const ok of okEntries) {
  console.log(`  ✓ ${ok.module} — wiki updated`)
}

if (violations.length === 0) {
  console.log('[wiki-sync] OK — every changed module has a wiki update')
  process.exit(0)
}

console.error('')
console.error('[wiki-sync] ✗ FAILED — module(s) changed without a wiki update:')
console.error('')
for (const v of violations) {
  console.error(`  • ${v.module} (slug: ${v.slug})`)
  console.error(`      wiki page  ${v.wikiPage}`)
  console.error(`      touched:`)
  for (const f of v.touched) console.error(`        - ${f}`)
}
console.error('')
console.error('Fix one of these:')
console.error('  1. Update the wiki page (bump CURRENT_VERSION + LAST_UPDATED + add a CHANGELOG row).')
console.error('  2. If the change truly does not need docs (refactor, dependency bump, test-only),')
console.error('     add a line to the commit body:  wiki-sync-skip: <one-line reason>')
console.error('  3. For a one-off local bypass, run with WIKI_SYNC_SKIP=1.')
console.error('')
console.error('Manifest: apps/web/app/wiki/_lib/manifest.json')
process.exit(1)
