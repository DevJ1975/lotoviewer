import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Enqueueing is on the learner's request path, so it must cost nothing for
// tenants without an LMS and must never fail an attempt.

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureException }))

import { enqueueStrikeXapi, strikeXapiStatementId } from '@/lib/strike/xapi'

const learner = { tenantId: 't1', userId: 'u1', memberId: 'm1', role: 'member', channel: 'account' as const }
const opts = { moduleId: 'mod-1', version: { id: 'ver-1', locale: 'en', title: null }, attemptId: 'att-1', events: [{ verb: 'attempted' as const }] }

function fakeAdmin(rows: Record<string, unknown>, upsertError: { message: string } | null = null) {
  const upserts: { rows: unknown; options: unknown }[] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
      chain.upsert = async (r: unknown, options: unknown) => { upserts.push({ rows: r, options }); return { error: upsertError } }
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, upserts }
}

describe('strikeXapiStatementId', () => {
  it('is a stable RFC 4122 v5-shaped UUID per (attempt, verb, activity)', () => {
    const id = strikeXapiStatementId('att-1', 'passed', 'https://x/modules/m')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(strikeXapiStatementId('att-1', 'passed', 'https://x/modules/m')).toBe(id)
    expect(strikeXapiStatementId('att-1', 'failed', 'https://x/modules/m')).not.toBe(id)
  })
})

describe('enqueueStrikeXapi', () => {
  it('writes nothing for a tenant without an enabled LRS', async () => {
    const { admin, upserts } = fakeAdmin({ strike_lrs_endpoints: { enabled: false } })
    await enqueueStrikeXapi(admin, learner, opts)
    expect(upserts).toHaveLength(0)
  })

  it('queues one statement per event, keyed by statement id so repeats are ignored', async () => {
    const { admin, upserts } = fakeAdmin({
      strike_lrs_endpoints: { enabled: true },
      strike_modules: { title: 'LOTO 101' },
      profiles: { full_name: 'Ana Ruiz', email: 'ana@plant.com' },
    })
    await enqueueStrikeXapi(admin, learner, opts)
    expect(upserts).toHaveLength(1)
    expect(upserts[0].options).toEqual({ onConflict: 'id', ignoreDuplicates: true })
    const [row] = upserts[0].rows as { id: string; verb: string; statement: { id: string; actor: { mbox: string } } }[]
    expect(row.verb).toBe('attempted')
    expect(row.statement.id).toBe(row.id)
    expect(row.statement.actor.mbox).toBe('mailto:ana@plant.com')
  })

  // The LRS stores the name under the version's language, so a Spanish
  // version must name itself in Spanish, not with the module's English title.
  it('names the activity with the title of a translated version', async () => {
    const { admin, upserts } = fakeAdmin({
      strike_lrs_endpoints: { enabled: true },
      strike_modules: { title: 'LOTO 101: Control of Hazardous Energy' },
      profiles: { full_name: 'Ana Ruiz', email: 'ana@plant.com' },
    })
    await enqueueStrikeXapi(admin, learner, { ...opts, version: { id: 'ver-2', locale: 'es', title: 'LOTO 101: Control de energía peligrosa' } })
    const [row] = upserts[0].rows as { statement: { object: { definition: { name: Record<string, string> } } } }[]
    expect(row.statement.object.definition.name).toEqual({ es: 'LOTO 101: Control de energía peligrosa' })
  })

  it('reports a storage failure to Sentry instead of failing the learner', async () => {
    const { admin } = fakeAdmin({ strike_lrs_endpoints: { enabled: true }, strike_modules: { title: 'T' }, profiles: {} }, { message: 'boom' })
    await expect(enqueueStrikeXapi(admin, learner, opts)).resolves.toBeUndefined()
    expect(captureException).toHaveBeenCalled()
  })
})
