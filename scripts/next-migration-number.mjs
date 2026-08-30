#!/usr/bin/env node
// Prints the next free migration prefix so contributors don't eyeball the
// directory and risk two branches both grabbing "max + 1" — the mistake that
// lands duplicate prefixes on main and breaks CI for every later PR (the
// `check-migration-numbers.mjs` guard catches it, but only after the fact).
//
// Convention (see docs/runbooks/versioning.md §4): migrations live in
// `apps/web/migrations/`, named `NNN_slug.sql` with a 3-digit zero-padded
// prefix; the next one is the current max + 1. An optional single letter
// (`059b_…`) slots a deliberate follow-up between releases — so a letter
// suffix never raises the max, and this helper always returns the next integer.
//
// Usage:
//   node scripts/next-migration-number.mjs            -> prints the next prefix
//   node scripts/next-migration-number.mjs my_feature -> prints 231_my_feature.sql
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

// Same parsing as check-migration-numbers.mjs: ignore `*_rollback.sql`
// companions and require the NNN[a-z]?_slug.sql shape.
const PREFIX_RE = /^(\d{3}[a-z]?)_[a-z0-9_]+\.sql$/

// Pure: highest numeric prefix + 1, zero-padded to 3 digits. Exported for tests
// and reuse; the I/O wrapper below is the only side effect.
export function nextPrefix(filenames) {
  const numbers = filenames
    .filter(n => /^\d/.test(n) && !/_rollback\.sql$/.test(n))
    .map(n => n.match(PREFIX_RE))
    .filter(Boolean)
    .map(m => parseInt(m[1].slice(0, 3), 10))
  const max = numbers.length > 0 ? Math.max(...numbers) : 0
  return String(max + 1).padStart(3, '0')
}

// Only run the I/O wrapper when invoked directly, not when imported by a test.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, '..', 'apps/web/migrations')
  const prefix = nextPrefix(readdirSync(dir))
  const slug = process.argv[2]

  if (slug) {
    console.log(`${prefix}_${slug}.sql`)
  } else {
    console.log(`Next free migration prefix: ${prefix}`)
    console.log(`  apps/web/migrations/${prefix}_<slug>.sql`)
    console.log('Tip: for a follow-up that must sort right after an existing NNN, name it NNNb instead.')
  }
}
