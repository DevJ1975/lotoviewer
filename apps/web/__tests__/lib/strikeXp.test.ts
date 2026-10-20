import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// XP is earned once per version's content. A translation of LOTO 101 (v2 'es')
// teaches what v1 'en' teaches, so passing both must not pay out twice.

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }))

import { awardPassXp } from '@/lib/strike/xp'

const VERSIONS: Record<string, { locale: string; version_number: number }> = {
  'ver-en-1': { locale: 'en', version_number: 1 },
  'ver-es-2': { locale: 'es', version_number: 2 },
}

function fakeAdmin() {
  const upserts: { event_type: string; dedupe_key: string }[][] = []
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {}
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'lte', 'order', 'limit']) chain[m] = () => chain
      chain.eq = (column: string, value: unknown) => { filters[column] = value; return chain }
      chain.maybeSingle = async () => {
        if (table !== 'strike_module_versions') return { data: null, error: null }
        if (filters.id) return { data: VERSIONS[filters.id as string] ?? null, error: null }
        return { data: filters.locale === 'en' ? { id: 'ver-en-1' } : null, error: null }
      }
      chain.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ block_key: 'i1' }], error: null }).then(resolve)
      chain.upsert = async (rows: { event_type: string; dedupe_key: string }[]) => { upserts.push(rows); return { error: null } }
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, upserts }
}

const pass = (versionId: string) => ({
  tenantId: 't1', memberId: 'm1', moduleId: 'mod-1', versionId, attemptId: `att-${versionId}`,
  assignmentId: null, passedAt: new Date('2026-10-20T12:00:00Z'), interactionKeys: new Set(['i1']),
})

describe('awardPassXp', () => {
  it('keys a pass on the version itself in the default language', async () => {
    const { admin, upserts } = fakeAdmin()
    await awardPassXp(admin, pass('ver-en-1'))
    expect(upserts[0].map(e => e.dedupe_key)).toEqual(['version:ver-en-1', 'version:ver-en-1:block:i1'])
  })

  it('keys a translation on the version it was translated from, so it earns nothing new', async () => {
    const { admin, upserts } = fakeAdmin()
    await awardPassXp(admin, pass('ver-en-1'))
    await awardPassXp(admin, pass('ver-es-2'))
    expect(upserts[1].map(e => e.dedupe_key)).toEqual(upserts[0].map(e => e.dedupe_key))
  })
})
