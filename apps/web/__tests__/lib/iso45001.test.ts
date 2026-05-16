import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ISO45001_CLAUSE_MAP,
  findClause,
  uniqueSourceTables,
} from '@soteria/core/iso45001'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

function migrationCorpus(): string {
  // Concatenate every migration into one long string so we can grep
  // for table references without parsing SQL. Skip seed_* and
  // data_hygiene_* which are admin scripts, not schema.
  const files = readdirSync(MIGRATIONS_DIR).filter(n => /^\d/.test(n) && n.endsWith('.sql'))
  return files.map(f => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n')
}

describe('ISO45001_CLAUSE_MAP', () => {
  it('lists at least one source table for every clause', () => {
    for (const entry of ISO45001_CLAUSE_MAP) {
      expect(entry.sources.length, `${entry.code} has no sources`).toBeGreaterThan(0)
    }
  })

  it('has no duplicate clause codes', () => {
    const codes = ISO45001_CLAUSE_MAP.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('uses canonical ISO 45001 clause-code format (digits and dots)', () => {
    for (const entry of ISO45001_CLAUSE_MAP) {
      expect(entry.code, `${entry.code} should match /^\\d+(\\.\\d+)*$/`)
        .toMatch(/^\d+(\.\d+)*$/)
    }
  })

  it('every source table is referenced somewhere in the migration history', () => {
    // Reading the migrations as plain text and grep'ing on
    // `public.<table>` catches the case where a typo creeps into the
    // clause map. We don't try to parse SQL; we only confirm the
    // identifier appears.
    const corpus = migrationCorpus()
    for (const source of uniqueSourceTables()) {
      const pattern = new RegExp(`public\\.${source}\\b`)
      expect(pattern.test(corpus), `${source} is not present in any migration`).toBe(true)
    }
  })

  it('produces a stable, sorted unique source-table list', () => {
    const sources = uniqueSourceTables()
    // Sorted lex — keeps the diff small when a future change adds a
    // source mid-alphabetically.
    expect([...sources]).toEqual([...sources].sort())
    // No duplicates after dedup — the helper's job.
    expect(new Set(sources).size).toBe(sources.length)
  })
})

describe('findClause', () => {
  it('returns the matching entry on an exact code', () => {
    const entry = findClause('10.2')
    expect(entry?.code).toBe('10.2')
    expect(entry?.sources).toContain('incident_capas')
  })

  it('returns null on an unknown code', () => {
    expect(findClause('99.99.99')).toBeNull()
    expect(findClause('')).toBeNull()
    expect(findClause('10.2.banana')).toBeNull()
  })

  it('is case-sensitive (no fuzzy matching)', () => {
    expect(findClause('10.2 ')).toBeNull()                // trailing space
    expect(findClause(' 10.2')).toBeNull()                // leading space
  })
})

describe('source-table correctness (no typos)', () => {
  it('never references a deleted helper table', () => {
    // Hand-picked sanity checks — these tables MUST exist because the
    // platform UI also depends on them. A typo here (e.g. "risk_" instead
    // of "risks") would silently break the clause page.
    expect(uniqueSourceTables()).toContain('risks')
    expect(uniqueSourceTables()).toContain('incidents')
    expect(uniqueSourceTables()).toContain('incident_capas')
    expect(uniqueSourceTables()).toContain('loto_periodic_inspections')
  })
})
