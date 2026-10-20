import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration-TEXT assertions (no database in the unit suite).
const raw = readFileSync(resolve(__dirname, '../../migrations/298_strike_coach_knowledge.sql'), 'utf8')
const sql = raw.replace(/--[^\n]*/g, '')

describe('strike_coach_knowledge migration', () => {
  it("adds 'training' to the knowledge source enum outside any transaction (as 109 does)", () => {
    const addValue = sql.indexOf("alter type public.knowledge_source_type add value if not exists 'training'")
    expect(addValue).toBeGreaterThan(-1)
    expect(addValue).toBeLessThan(sql.indexOf('begin;'))
  })

  it('separates coach threads from home-assistant threads without breaking existing rows', () => {
    expect(sql).toMatch(/add column if not exists surface text not null default 'assistant'/)
    expect(sql).toMatch(/check \(surface in \('assistant', 'strike_coach'\)\)/)
  })
})
