import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('@/lib/strike/xapi', () => ({ enqueueStrikeXapi: vi.fn() }))

import { openAttempt, type StrikeLearner } from '@/lib/strike/attempts'

function fakeAdmin() {
  const inserts: Array<{ table: string; payload: Record<string, unknown> }> = []
  const admin = {
    from(table: string) {
      let inserting = false
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'is', 'gte', 'order', 'limit']) chain[m] = () => chain
      chain.insert = (payload: Record<string, unknown>) => { inserting = true; inserts.push({ table, payload }); return chain }
      chain.maybeSingle = async () => ({ data: null, error: null })
      chain.single = async () => ({ data: inserting ? { id: 'att-new' } : null, error: null })
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, inserts }
}

const version = { id: 'ver-1', module_id: 'mod-1', locale: 'en', version_number: 1 } as unknown as Parameters<typeof openAttempt>[2]['version']

describe('openAttempt', () => {
  // An assisted kiosk session is signed off later by a different person, so
  // the attempt itself must carry who issued the kiosk link.
  it('records who issued the kiosk link on a kiosk attempt', async () => {
    const { admin, inserts } = fakeAdmin()
    const learner: StrikeLearner = { tenantId: 't1', userId: null, memberId: 'm1', role: null, channel: 'kiosk', kioskIssuedBy: 'lead-7' }
    await openAttempt(admin, learner, { moduleId: 'mod-1', version, assignmentId: null, delivery: 'assisted' })
    expect(inserts.find(i => i.table === 'strike_attempts')?.payload.client_context).toEqual({ mode: 'kiosk_player', kiosk_issued_by: 'lead-7' })
  })

  it('adds no issuer for a signed-in learner', async () => {
    const { admin, inserts } = fakeAdmin()
    const learner: StrikeLearner = { tenantId: 't1', userId: 'u1', memberId: 'm1', role: 'member', channel: 'account' }
    await openAttempt(admin, learner, { moduleId: 'mod-1', version, assignmentId: null, delivery: 'standard' })
    expect(inserts.find(i => i.table === 'strike_attempts')?.payload.client_context).toEqual({ mode: 'learner_player' })
  })
})
