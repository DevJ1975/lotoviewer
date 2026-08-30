#!/usr/bin/env node
// Fails loudly when apps/web/migrations/ and the production ledger
// (supabase_migrations.schema_migrations) have drifted — in EITHER
// direction:
//
//   1. a numbered migration file with no ledger row and no baseline
//      acknowledgement  → merged but never applied (the migration-257
//      failure mode: a cron erroring 288×/day against missing tables);
//   2. a ledger row with no matching file and no baseline
//      acknowledgement  → applied out-of-band and never committed (the
//      construction-projects failure mode: 7 tables a rebuild would
//      silently lose).
//
// The ledger records timestamp versions with free-form names while the
// repo numbers files NNN_slug.sql, so rows are matched by name: exact
// `NNN_slug`, exact slug, slug with a trailing _NNN[a-z]? shed (the
// early ledger wrote `incidents_core_059` for 059_incidents_core.sql,
// and some slugs were renumbered before merge), then the explicit
// alias map in scripts/migration-drift-baseline.json for the handful
// history spelled differently. Everything already reconciled on
// 2026-08-28 is acknowledged in that baseline; this check only fails
// on NEW drift. Delete baseline entries as they get fixed — entries
// the check reports as stale are safe to remove.
//
// Needs a direct Postgres connection (the ledger schema is not exposed
// over PostgREST), so it is OPT-IN: set SUPABASE_DB_URL to the
// project's postgres:// connection string (Dashboard → Connect →
// Direct connection; any read-only role works — the script only ever
// SELECTs). Without it the check skips cleanly so the offline
// `check:repo` chain stays green.
//
// Usage:
//   SUPABASE_DB_URL=postgres://… node scripts/check-migration-drift.mjs
//   node scripts/check-migration-drift.mjs            -> skipped (no env)
//
// Test hook: MIGRATION_DRIFT_LEDGER_FILE=/path/to/file bypasses psql and
// reads "version name" lines instead — used by tests and for offline
// verification against a saved ledger snapshot.
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const dir = resolve(repo, 'apps/web/migrations')
const baselinePath = resolve(here, 'migration-drift-baseline.json')

// ── 0. Opt-in gate ─────────────────────────────────────────────────────
const ledgerFile = process.env.MIGRATION_DRIFT_LEDGER_FILE
const dbUrl = process.env.SUPABASE_DB_URL
if (!ledgerFile && !dbUrl) {
  console.log('[migration-drift] skipped (SUPABASE_DB_URL not set — opt-in check, see script header)')
  process.exit(0)
}

// ── 1. Load the ledger ─────────────────────────────────────────────────
// One "version name" pair per row. Versions are 14-digit timestamps.
function loadLedger() {
  if (ledgerFile) {
    return readFileSync(ledgerFile, 'utf8').trim().split('\n').map(parseRow)
  }
  const sql = "select version || ' ' || name from supabase_migrations.schema_migrations order by version"
  const res = spawnSync('psql', [dbUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' })
  if (res.error?.code === 'ENOENT') {
    console.error('[migration-drift] SUPABASE_DB_URL is set but `psql` is not on PATH — install postgresql client tools')
    process.exit(1)
  }
  if (res.status !== 0) {
    console.error('[migration-drift] psql failed:')
    console.error(res.stderr?.trim())
    process.exit(1)
  }
  return res.stdout.trim().split('\n').filter(Boolean).map(parseRow)
}
function parseRow(line) {
  const sp = line.indexOf(' ')
  return { version: line.slice(0, sp), name: line.slice(sp + 1).trim() }
}

// ── 2. Load the repo side ──────────────────────────────────────────────
// Same shape as check-migration-numbers.mjs, with one refinement: only a
// PURE rollback companion (`NNN_rollback.sql`) is excluded. The broader
// `*_rollback.sql` filter used there silently drops the forward migration
// 219_loto_audit_apply_and_rollback.sql.
const PREFIX_RE = /^(\d{3}[a-z]?)_([a-z0-9_]+)\.sql$/
const all = readdirSync(dir).filter(n => n.endsWith('.sql'))
const numbered = all.filter(n => PREFIX_RE.test(n) && !/^\d{3}[a-z]?_rollback\.sql$/.test(n))
const filesBySlug = new Map()
for (const f of numbered) {
  const slug = f.match(PREFIX_RE)[2]
  const list = filesBySlug.get(slug) ?? []
  list.push(f)
  filesBySlug.set(slug, list)
}
const allFiles = new Set(all)

// ── 3. Baseline ────────────────────────────────────────────────────────
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const aliases = baseline.ledger_aliases ?? {}
const appliedNoLedger = new Set(baseline.repo_applied_without_ledger ?? [])
const knownUnapplied = new Set(baseline.repo_known_unapplied ?? [])
const outOfBand = baseline.db_out_of_band ?? {}

// ── 4. Match every ledger row to a file ────────────────────────────────
const uniqueSlug = s => {
  const c = filesBySlug.get(s)
  return c?.length === 1 ? c[0] : null
}
function matchRow(name) {
  if (allFiles.has(`${name}.sql`)) return `${name}.sql`            // NNN_slug exact
  const t2 = name.match(/^\d{3}_(.+)$/)                            // NNN_slug, renumbered
  if (t2) { const f = uniqueSlug(t2[1]); if (f) return f }
  const f1 = uniqueSlug(name)                                      // bare slug
  if (f1) return f1
  const t3 = name.replace(/_\d{2,3}[a-z]?$/, '')                   // slug_NNN[a-z]
  if (t3 !== name) { const f = uniqueSlug(t3); if (f) return f }
  if (aliases[name] && allFiles.has(aliases[name])) return aliases[name]
  return null
}

const ledger = loadLedger()
const matchedFiles = new Set()
const dbDrift = []
for (const row of ledger) {
  const f = matchRow(row.name)
  if (f) matchedFiles.add(f)
  else if (!(row.version in outOfBand)) dbDrift.push(row)
}

// ── 5. Repo → DB direction ─────────────────────────────────────────────
const repoDrift = []
const warnings = []
for (const f of numbered) {
  if (matchedFiles.has(f)) continue
  if (knownUnapplied.has(f)) { warnings.push(`${f} — in baseline repo_known_unapplied (apply it, then remove the entry)`); continue }
  if (appliedNoLedger.has(f)) continue
  repoDrift.push(f)
}

// Stale-baseline hygiene: entries that no longer describe reality.
const stale = []
for (const f of [...knownUnapplied, ...appliedNoLedger]) {
  if (matchedFiles.has(f)) stale.push(`${f} — now has a ledger row; remove it from the baseline`)
  else if (!allFiles.has(f)) stale.push(`${f} — file no longer exists; remove it from the baseline`)
}
for (const [version, name] of Object.entries(outOfBand)) {
  if (!ledger.some(r => r.version === version)) stale.push(`db_out_of_band ${version} (${name}) — no longer in the ledger; remove it from the baseline`)
}

// ── 6. Report ──────────────────────────────────────────────────────────
for (const w of warnings) console.log(`[migration-drift] warn: ${w}`)
for (const s of stale) console.log(`[migration-drift] stale baseline entry: ${s}`)

let failed = false
if (repoDrift.length > 0) {
  failed = true
  console.error('\n[migration-drift] FAIL — migration files with no ledger row (merged but never applied?):')
  for (const f of repoDrift) console.error(`  - apps/web/migrations/${f}`)
  console.error('  Apply them to production (which records a ledger row), or — only if verified')
  console.error('  applied by hand — add them to repo_applied_without_ledger in scripts/migration-drift-baseline.json.')
}
if (dbDrift.length > 0) {
  failed = true
  console.error('\n[migration-drift] FAIL — ledger rows with no matching migration file (applied out-of-band?):')
  for (const r of dbDrift) console.error(`  - ${r.version} ${r.name}`)
  console.error('  Recover the SQL into a numbered migration file:')
  console.error("    select array_to_string(statements, E'\\n') from supabase_migrations.schema_migrations where version = '<version>';")
  console.error('  then map it via ledger_aliases in scripts/migration-drift-baseline.json (or, for')
  console.error('  data-only hygiene rows, acknowledge the version under db_out_of_band).')
}

if (failed) process.exit(1)
console.log(`[migration-drift] OK (${ledger.length} ledger rows, ${numbered.length} migration files, ${warnings.length} acknowledged-unapplied)`)
