#!/usr/bin/env node
// Refuses to ship when a top-level feature in
// packages/core/src/features.ts has no corresponding stub manual in
// the seed file (apps/web/migrations/seed_module_manuals.sql).
//
// Catches the regression where someone ships a new module + drawer
// entry but forgets to write its manual. The runtime bootstrap
// endpoint (/api/superadmin/manuals/bootstrap) creates rows in the
// DB; this CI guard makes sure the seed-file source of truth keeps
// up so a fresh deploy includes them.
//
// Skipped when ALLOW_MISSING_MANUAL_STUBS=1 (for transient
// feature-branch states). The merge into main should still cover it.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

if (process.env.ALLOW_MISSING_MANUAL_STUBS === '1') {
  console.log('[manual-coverage] skipped (ALLOW_MISSING_MANUAL_STUBS=1)')
  process.exit(0)
}

const featuresPath = resolve(repo, 'packages/core/src/features.ts')
const seedPath     = resolve(repo, 'apps/web/migrations/seed_module_manuals.sql')

const featuresSrc = readFileSync(featuresPath, 'utf8')
const seedSrc     = readFileSync(seedPath, 'utf8')

// Pull every `id: 'foo'` (single-quoted) from the FEATURES catalog
// AND its parent: 'bar' lines. Anything that has a `parent:` value
// is a child feature whose manual is the parent's. Anything with
// `internal: true` isn't a routable surface — skip. Anything that
// is the manuals feature itself — skip.
//
// We parse the source textually to avoid pulling in a bundler /
// running TS at script-time. The patterns below match the
// FEATURES literal as-written. If the literal style ever changes
// (e.g. trailing-comma layout), this regex needs to follow.
const blocks = featuresSrc.match(/\{[^{}]*id:\s*'[^']+'[^{}]*\}/g) ?? []
const candidates = []
for (const block of blocks) {
  const id   = block.match(/id:\s*'([^']+)'/)?.[1]
  const enabled = !/enabled:\s*false/.test(block)
  const hasParent  = /parent:\s*'/.test(block)
  const isInternal = /internal:\s*true/.test(block)
  if (!id || !enabled || hasParent || isInternal) continue
  if (id === 'manuals' || id === 'support') continue  // self + meta
  candidates.push(id)
}

// The seed-file rows are `('module-id', '...', '...', ...)`. Pull the
// first single-quoted token in each row.
const seeded = new Set()
for (const m of seedSrc.matchAll(/^\s*\('([a-z0-9][a-z0-9-]+)',/gm)) {
  seeded.add(m[1])
}

const missing = candidates.filter(id => !seeded.has(id))

if (missing.length > 0) {
  console.error('[manual-coverage] features without a stub manual in seed_module_manuals.sql:')
  for (const id of missing) console.error(`  - ${id}`)
  console.error('')
  console.error('Add a row to apps/web/migrations/seed_module_manuals.sql for each, or set')
  console.error('ALLOW_MISSING_MANUAL_STUBS=1 to bypass for a transient feature-branch state.')
  process.exit(1)
}

console.log(`[manual-coverage] OK (${candidates.length} top-level features, all with stub manuals)`)
