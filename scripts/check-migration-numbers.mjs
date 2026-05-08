#!/usr/bin/env node
// Refuses to ship when two migration files share the same numeric
// prefix (e.g. both `069_toolbox_talks.sql` and
// `069_osha_ita_submission.sql` exist). Two migrations with the same
// prefix break the apply-order assumption and become a footgun the
// moment the order matters.
//
// Convention: migrations live in `apps/web/migrations/`, named
// `NNN_short_slug.sql` where NNN is a 3-digit zero-padded integer.
// Files that don't match (like `seed_home_demo.sql` or
// `data_hygiene_*.sql`) are ignored — they're applied manually.
//
// Skipped when `ALLOW_MIGRATION_COLLISIONS=1` so a feature branch
// can rebase across an in-flight conflict without immediately
// breaking the build. The merge into main should still resolve it.
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const dir  = resolve(repo, 'apps/web/migrations')

if (process.env.ALLOW_MIGRATION_COLLISIONS === '1') {
  console.log('[migration-numbers] skipped (ALLOW_MIGRATION_COLLISIONS=1)')
  process.exit(0)
}

const files = readdirSync(dir).filter(n => n.endsWith('.sql'))
// `*_rollback.sql` files are paired companions of an existing forward
// migration (e.g. `029_rollback.sql` reverses `029_multi_tenant_rls.sql`).
// They're hand-applied in emergencies, not part of the forward chain,
// so they're allowed to share a prefix with their forward sibling.
const numbered = files.filter(n => /^\d/.test(n) && !/_rollback\.sql$/.test(n))

// Sanity check: every numbered file must be NNN[a-z]?_slug.sql with a
// 3-digit zero-padded prefix and an optional single-letter suffix
// (e.g. `059b_migrate_near_miss.sql` for a follow-up to 059). A
// 4-digit or 2-digit prefix would silently sort wrong.
const PREFIX_RE = /^(\d{3}[a-z]?)_[a-z0-9_]+\.sql$/
const malformed = numbered.filter(n => !PREFIX_RE.test(n))
if (malformed.length > 0) {
  console.error('[migration-numbers] files with malformed numeric prefix (expected NNN[a-z]?_slug.sql):')
  for (const f of malformed) console.error(`  - ${f}`)
  process.exit(1)
}

// Group by full prefix (digits + optional letter) and flag any
// duplicates. `059_*` and `059b_*` count as DISTINCT slots — the
// letter is the disambiguator.
const byPrefix = new Map()
for (const f of numbered) {
  const prefix = f.match(PREFIX_RE)[1]
  const list = byPrefix.get(prefix) ?? []
  list.push(f)
  byPrefix.set(prefix, list)
}

const duplicates = [...byPrefix.entries()].filter(([, list]) => list.length > 1)
if (duplicates.length > 0) {
  console.error('[migration-numbers] duplicate migration prefixes found:')
  for (const [prefix, list] of duplicates) {
    console.error(`  ${prefix}:`)
    for (const f of list.sort()) console.error(`    - ${f}`)
  }
  console.error('')
  console.error('Pick a fresh, higher prefix for one of them. Set')
  console.error('ALLOW_MIGRATION_COLLISIONS=1 to bypass for a transient feature-branch state.')
  process.exit(1)
}

console.log(`[migration-numbers] OK (${numbered.length} migrations, all unique)`)
