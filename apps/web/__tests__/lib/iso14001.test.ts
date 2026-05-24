import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  ISO14001_CLAUSE_MAP,
  findClause,
  uniqueSourceTables,
} from '@soteria/core/iso14001'

const MIGRATIONS_DIR = path.resolve(__dirname, '../../migrations')

function migrationCorpus(): string {
  // Concatenate every numbered migration into one string so we can grep
  // for table references without parsing SQL. Skip seed_* and
  // data_hygiene_* which are admin scripts, not schema.
  const files = readdirSync(MIGRATIONS_DIR).filter(n => /^\d/.test(n) && n.endsWith('.sql'))
  return files.map(f => readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8')).join('\n')
}

describe('ISO14001_CLAUSE_MAP', () => {
  it('lists at least one source table for every clause', () => {
    for (const entry of ISO14001_CLAUSE_MAP) {
      expect(entry.sources.length, `${entry.code} has no sources`).toBeGreaterThan(0)
    }
  })

  it('has no duplicate clause codes', () => {
    const codes = ISO14001_CLAUSE_MAP.map(c => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('uses canonical ISO 14001 clause-code format (digits and dots)', () => {
    for (const entry of ISO14001_CLAUSE_MAP) {
      expect(entry.code, `${entry.code} should match /^\\d+(\\.\\d+)*$/`)
        .toMatch(/^\d+(\.\d+)*$/)
    }
  })

  it('every source table is referenced somewhere in the migration history', () => {
    const corpus = migrationCorpus()
    for (const source of uniqueSourceTables()) {
      const pattern = new RegExp(`public\\.${source}\\b`)
      expect(pattern.test(corpus), `${source} is not present in any migration`).toBe(true)
    }
  })

  it('produces a stable, sorted unique source-table list', () => {
    const sources = uniqueSourceTables()
    expect([...sources]).toEqual([...sources].sort())
    expect(new Set(sources).size).toBe(sources.length)
  })
})

describe('findClause', () => {
  it('returns the matching entry on an exact code', () => {
    const entry = findClause('6.1.2')
    expect(entry?.code).toBe('6.1.2')
    expect(entry?.sources).toContain('environmental_aspects')
  })

  it('returns null on an unknown code', () => {
    expect(findClause('99.99.99')).toBeNull()
    expect(findClause('')).toBeNull()
    expect(findClause('6.1.2.banana')).toBeNull()
  })

  it('is case-sensitive (no fuzzy matching)', () => {
    expect(findClause('6.1.2 ')).toBeNull()
    expect(findClause(' 6.1.2')).toBeNull()
  })
})

describe('source-table correctness (no typos)', () => {
  it('references the environmental modules that back the EMS', () => {
    // These tables MUST exist because the platform UI also depends on
    // them. A typo here (e.g. "incident" instead of "incidents") would
    // silently break the clause page.
    const sources = uniqueSourceTables()
    expect(sources).toContain('environmental_aspects')
    expect(sources).toContain('incidents')
    expect(sources).toContain('compliance_calendar_obligations')
    expect(sources).toContain('hazardous_waste_streams')
    expect(sources).toContain('risks')
  })
})
