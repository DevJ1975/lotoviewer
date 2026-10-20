import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

// Supervisor sign-off is the only path that writes a completion without a
// quiz score, so every refusal below is a way a completion could otherwise
// be forged or doubled.

const { awardPassXp, enqueueStrikeXapi } = vi.hoisted(() => ({ awardPassXp: vi.fn(), enqueueStrikeXapi: vi.fn() }))
vi.mock('@/lib/strike/xp', () => ({ awardPassXp }))
vi.mock('@/lib/strike/xapi', () => ({ enqueueStrikeXapi }))

import { verifyAssistedAttempt } from '@/lib/strike/assisted'

const seed = JSON.parse(readFileSync(resolve(__dirname, '../../../../services/learning-studio/seed/loto-101/module.json'), 'utf8'))
const SCENES = seed.content.blocks.filter((b: { kind: string }) => b.kind === 'motion_scene').map((b: { key: string }) => b.key) as string[]
const ALL_KEYS = ['discussed', 'callout:c1-stored', 'questions', 'demonstrated']

interface Call { table: string; op: string; payload?: unknown; filters: unknown[][] }

function fakeAdmin(overrides: Partial<Record<string, unknown>> = {}) {
  const data: Record<string, unknown> = {
    attempt: { id: 'att-1', tenant_id: 't1', module_id: 'mod-1', module_version_id: 'ver-1', assignment_id: null, user_id: null, member_id: 'm1', delivery: 'assisted', submitted_at: null },
    member: { preferred_name: null, display_name: 'Ana Ruiz', profile_id: null },
    module: { id: 'mod-1', tenant_id: 't1', library_scope: 'tenant', status: 'published', title: 'LOTO 101' },
    version: { id: 'ver-1', module_id: 'mod-1', status: 'published', content: seed.content, locale: 'en', validity_days: 365, passing_score: 80 },
    events: SCENES.map(block_key => ({ block_key, event: 'completed' })),
    verificationInsert: { data: { id: 'ver-rec-1' }, error: null },
    completionInsert: { data: { id: 'comp-1' }, error: null },
    ...overrides,
  }
  const calls: Call[] = []
  const admin = {
    from(table: string) {
      const call: Call = { table, op: 'select', filters: [] }
      calls.push(call)
      const result = () => {
        if (call.op === 'insert' && table === 'strike_assisted_verifications') return data.verificationInsert
        if (call.op === 'insert' && table === 'strike_completions') return data.completionInsert
        if (call.op !== 'select') return { data: null, error: null }
        switch (table) {
          case 'strike_attempts': return { data: data.attempt, error: null }
          case 'members': return { data: data.member, error: null }
          case 'profiles': return { data: { full_name: 'Ana Ruiz', email: 'ana@plant.com' }, error: null }
          case 'strike_modules': return { data: data.module, error: null }
          case 'strike_module_versions': return { data: data.version, error: null }
          case 'strike_block_events': return { data: data.events, error: null }
          default: return { data: null, error: null }
        }
      }
      const chain: Record<string, unknown> = {
        select: () => chain,
        insert: (payload: unknown) => { call.op = 'insert'; call.payload = payload; return chain },
        update: (payload: unknown) => { call.op = 'update'; call.payload = payload; return chain },
        delete: () => { call.op = 'delete'; return chain },
        maybeSingle: async () => result(),
        single: async () => result(),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      for (const m of ['eq', 'is', 'in']) chain[m] = (...args: unknown[]) => { call.filters.push([m, ...args]); return chain }
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, calls }
}

const verifier = { tenantId: 't1', userId: 'sup-1', name: 'Sam Supervisor' }
const input = { attemptId: 'att-1', checkedKeys: ALL_KEYS, signaturePng: 'data:image/png;base64,AAAA' }

beforeEach(() => {
  awardPassXp.mockReset()
  enqueueStrikeXapi.mockReset()
})

describe('verifyAssistedAttempt', () => {
  it('records the signed checklist in the server’s own words and a score-less completion', async () => {
    const { admin, calls } = fakeAdmin()
    const result = await verifyAssistedAttempt(admin, verifier, input)
    expect(result).toEqual({ ok: true, value: { completionId: 'comp-1', signedAt: expect.any(String) } })

    const verification = calls.find(c => c.table === 'strike_assisted_verifications' && c.op === 'insert')?.payload as Record<string, unknown>
    expect(verification).toMatchObject({ attempt_id: 'att-1', verifier_user_id: 'sup-1', verifier_name: 'Sam Supervisor', locale: 'en' })
    expect((verification.checklist as { key: string; text: string }[]).map(i => i.key)).toEqual(ALL_KEYS)
    expect((verification.checklist as { text: string }[])[0].text).toContain('Ana Ruiz')
    expect(verification.acknowledgment).toMatch(/Ana Ruiz understands “LOTO 101”/)

    const completion = calls.find(c => c.table === 'strike_completions' && c.op === 'insert')?.payload as Record<string, unknown>
    expect(completion).toMatchObject({ score_percent: null, passed: true, member_id: 'm1', evidence: { mode: 'assisted_verified', verified_by: 'sup-1' } })
    const attemptUpdate = calls.find(c => c.table === 'strike_attempts' && c.op === 'update')
    expect(attemptUpdate?.filters).toContainEqual(['is', 'submitted_at', null])
    expect(enqueueStrikeXapi).toHaveBeenCalledWith(admin, expect.objectContaining({ memberId: 'm1' }), expect.objectContaining({ events: [{ verb: 'completed', block: null }] }))
  })

  // A kiosk session is opened by one person and signed off by another; the
  // completion must still name who handed the worker the kiosk link, as a
  // kiosk quiz pass does.
  it('keeps who issued the kiosk link on a kiosk session’s completion', async () => {
    const { admin, calls } = fakeAdmin({
      attempt: { id: 'att-1', tenant_id: 't1', module_id: 'mod-1', module_version_id: 'ver-1', assignment_id: null, user_id: null, member_id: 'm1', delivery: 'assisted', submitted_at: null, client_context: { mode: 'kiosk_player', kiosk_issued_by: 'lead-7' } },
    })
    expect((await verifyAssistedAttempt(admin, verifier, input)).ok).toBe(true)
    const completion = calls.find(c => c.table === 'strike_completions' && c.op === 'insert')?.payload as { evidence: Record<string, unknown> }
    expect(completion.evidence).toMatchObject({ channel: 'kiosk', kiosk_issued_by: 'lead-7' })
    const attemptUpdate = calls.find(c => c.table === 'strike_attempts' && c.op === 'update')?.payload as { client_context: Record<string, unknown> }
    expect(attemptUpdate.client_context).toMatchObject({ mode: 'assisted', kiosk_issued_by: 'lead-7' })
  })

  // The stored record must say exactly what the supervisor read and signed,
  // which on a Spanish version is the Spanish title, not the module's.
  it('signs a Spanish session with the Spanish version title', async () => {
    const es = JSON.parse(readFileSync(resolve(__dirname, '../../../../services/learning-studio/seed/loto-101/module.es.json'), 'utf8'))
    const { admin, calls } = fakeAdmin({
      version: { id: 'ver-2', module_id: 'mod-1', status: 'published', content: es.content, locale: 'es', title: 'LOTO 101: Control de energía peligrosa', validity_days: 365, passing_score: 80 },
    })
    expect(await verifyAssistedAttempt(admin, verifier, input)).toMatchObject({ ok: true })
    const verification = calls.find(c => c.table === 'strike_assisted_verifications' && c.op === 'insert')?.payload as Record<string, unknown>
    expect(verification.locale).toBe('es')
    expect(verification.acknowledgment).toMatch(/Ana Ruiz entiende “LOTO 101: Control de energía peligrosa”/)
  })

  it('refuses a standard (quiz) session', async () => {
    const { admin } = fakeAdmin({ attempt: { id: 'att-1', tenant_id: 't1', module_id: 'mod-1', module_version_id: 'ver-1', assignment_id: null, user_id: null, member_id: 'm1', delivery: 'standard', submitted_at: null } })
    expect(await verifyAssistedAttempt(admin, verifier, input)).toMatchObject({ ok: false, status: 409 })
  })

  it('refuses a session from another tenant as if it did not exist', async () => {
    const { admin } = fakeAdmin()
    expect(await verifyAssistedAttempt(admin, { ...verifier, tenantId: 't2' }, input)).toMatchObject({ ok: false, status: 404 })
  })

  it('refuses a supervisor signing their own training', async () => {
    const { admin } = fakeAdmin({ member: { preferred_name: null, display_name: 'Sam', profile_id: 'sup-1' } })
    expect(await verifyAssistedAttempt(admin, verifier, input)).toMatchObject({ ok: false, status: 403 })
  })

  it('refuses until every video was played through', async () => {
    const { admin } = fakeAdmin({ events: SCENES.slice(0, -1).map(block_key => ({ block_key, event: 'completed' })) })
    expect(await verifyAssistedAttempt(admin, verifier, input)).toMatchObject({ ok: false, status: 422, message: 'The worker still has 1 video to watch.' })
  })

  it('refuses an incomplete checklist, including a skipped safety callout', async () => {
    const { admin } = fakeAdmin()
    const result = await verifyAssistedAttempt(admin, verifier, { ...input, checkedKeys: ['discussed', 'questions', 'demonstrated'] })
    expect(result).toMatchObject({ ok: false, status: 422 })
  })

  it('treats a second signature on the same session as already verified', async () => {
    const { admin } = fakeAdmin({ verificationInsert: { data: null, error: { code: '23505', message: 'duplicate key' } } })
    expect(await verifyAssistedAttempt(admin, verifier, input)).toMatchObject({ ok: false, status: 409 })
  })

  it('removes the signature when the completion cannot be written, so the supervisor can sign again', async () => {
    const { admin, calls } = fakeAdmin({ completionInsert: { data: null, error: { message: 'boom' } } })
    await expect(verifyAssistedAttempt(admin, verifier, input)).rejects.toThrow('boom')
    expect(calls.some(c => c.table === 'strike_assisted_verifications' && c.op === 'delete')).toBe(true)
    expect(calls.some(c => c.table === 'strike_attempts' && c.op === 'update')).toBe(false)
  })
})
