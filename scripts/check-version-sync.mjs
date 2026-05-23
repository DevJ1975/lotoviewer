#!/usr/bin/env node
// Refuses to ship when the platform version drifts across the three places
// it is declared by hand:
//
//   1. package.json                 (monorepo root)
//   2. apps/web/package.json        (the deployed web app)
//   3. apps/web/lib/version.ts      (VERSION — surfaced in the UI footer)
//
// A release bumps all three together (see docs/runbooks/versioning.md). When
// they disagree, the footer/About tile shows a version that doesn't match the
// package metadata or the release tag — a quiet footgun during incident
// triage. This guard catches it before merge.
//
// Skipped when ALLOW_VERSION_DRIFT=1 so a mid-release branch can stage a bump
// across commits without breaking the build. The merge into main must agree.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

if (process.env.ALLOW_VERSION_DRIFT === '1') {
  console.log('[version-sync] skipped (ALLOW_VERSION_DRIFT=1)')
  process.exit(0)
}

function readJsonVersion(relPath) {
  const raw = readFileSync(resolve(repo, relPath), 'utf8')
  const { version } = JSON.parse(raw)
  return { source: relPath, version }
}

function readTsVersion(relPath) {
  const raw = readFileSync(resolve(repo, relPath), 'utf8')
  const m = raw.match(/export\s+const\s+VERSION\s*=\s*['"]([^'"]+)['"]/)
  return { source: relPath, version: m ? m[1] : null }
}

const sources = [
  readJsonVersion('package.json'),
  readJsonVersion('apps/web/package.json'),
  readTsVersion('apps/web/lib/version.ts'),
]

const missing = sources.filter(s => !s.version)
if (missing.length > 0) {
  console.error('[version-sync] could not read a version from:')
  for (const s of missing) console.error(`  - ${s.source}`)
  process.exit(1)
}

const unique = [...new Set(sources.map(s => s.version))]
if (unique.length > 1) {
  console.error('[version-sync] version mismatch across declared sources:')
  for (const s of sources) console.error(`  - ${s.source}: ${s.version}`)
  console.error('')
  console.error('Bump all three to the same semver (see docs/runbooks/versioning.md).')
  console.error('Set ALLOW_VERSION_DRIFT=1 to bypass for a transient mid-release state.')
  process.exit(1)
}

console.log(`[version-sync] OK (all sources at ${unique[0]})`)
