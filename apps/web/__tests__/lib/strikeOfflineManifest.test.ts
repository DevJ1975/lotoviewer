import { beforeEach, describe, expect, it } from 'vitest'
import { createDecipheriv } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { scoreStrikeQuiz } from '@soteria/core/strike'
import { buildOfflineManifest } from '@/lib/strike/offlineManifest'
import type { OfflineAnswerKeyPayload } from '@/lib/strike/offlineKey'

type Rows = Record<string, unknown[]>

// Every table is read a page at a time until an empty page, so each query
// answers its rows once and then nothing.
function fakeAdmin(rows: Rows) {
  const served = new Map<string, number>()
  const filters: [string, string, unknown][] = []
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'not', 'order', 'limit', 'range', 'or']) chain[m] = () => chain
      chain.eq = (c: string, v: unknown) => { filters.push([table, c, v]); return chain }
      chain.in = (c: string, v: unknown) => { filters.push([table, c, v]); return chain }
      chain.then = (resolve: (v: unknown) => unknown) => {
        const n = served.get(table) ?? 0
        served.set(table, n + 1)
        return Promise.resolve({ data: n === 0 ? rows[table] ?? [] : [], error: null }).then(resolve)
      }
      return chain
    },
  }
  return { admin: admin as unknown as SupabaseClient, filters }
}

const content = { blocks: [{ kind: 'motion_scene', key: 's1', eyebrow: null, title: 'Why', script: 'x', beats: [], animation: 'static', image: { path: 'global/loto-101/v1/s1.jpg', alt: 'a', approval: 'approved' }, narration: null }] }

const baseRows = (): Rows => ({
  strike_modules: [{ id: 'mod-1', title: 'LOTO 101', description: null, category: 'loto', estimated_minutes: 5 }],
  strike_module_versions: [
    { id: 'ver-en-1', module_id: 'mod-1', locale: 'en', version_number: 1, title: null, passing_score: 80, retake_limit: 3, validity_days: 365, content },
    { id: 'ver-en-2', module_id: 'mod-1', locale: 'en', version_number: 2, title: null, passing_score: 80, retake_limit: 3, validity_days: 365, content },
    { id: 'ver-es-1', module_id: 'mod-1', locale: 'es', version_number: 1, title: 'LOTO 101 (ES)', passing_score: 80, retake_limit: 3, validity_days: 365, content },
  ],
  strike_quiz_questions: [
    { id: 'q1', module_version_id: 'ver-en-2', question_type: 'multiple_choice', prompt: 'First step?', sort_order: 2, required: true, points: 1, explanation: 'Notify first.' },
    { id: 'q0', module_version_id: 'ver-en-2', question_type: 'true_false', prompt: 'Tags alone are enough?', sort_order: 1, required: true, points: 2, explanation: null },
  ],
  strike_quiz_answers: [
    { id: 'a1', question_id: 'q1', answer_text: 'Notify affected workers', sort_order: 1, is_correct: true },
    { id: 'a2', question_id: 'q1', answer_text: 'Open the guard', sort_order: 2, is_correct: false },
    { id: 'f', question_id: 'q0', answer_text: 'False', sort_order: 2, is_correct: true },
    { id: 't', question_id: 'q0', answer_text: 'True', sort_order: 1, is_correct: false },
  ],
  members: [{ id: 'm1', display_name: 'Maria Lopez', preferred_name: 'Mari' }, { id: 'm2', display_name: 'Sam Ito', preferred_name: null }],
  member_identifier_hashes: [{ member_id: 'm1', identifier_type: 'badge_id', search_key_hash: 'h-badge-1' }],
})

const device = { id: 'dev-1', tenantId: 't1', name: 'Line 3', department: null, siteLabel: null, enrolledBy: 'admin-1' }
const NOW = new Date('2026-10-20T18:00:00Z')

function decrypt(secretB64: string, enc: { iv: string; data: string }): OfflineAnswerKeyPayload {
  const data = Buffer.from(enc.data, 'base64')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(secretB64, 'base64'), Buffer.from(enc.iv, 'base64'))
  decipher.setAuthTag(data.subarray(data.length - 16))
  return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, data.length - 16)), decipher.final()]).toString('utf8'))
}

beforeEach(() => { process.env.STRIKE_OFFLINE_SECRET = 'test-offline-secret-at-least-32-characters-long' })

describe('buildOfflineManifest', () => {
  it('carries the newest published version of each language, not the old ones', async () => {
    const manifest = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    expect(manifest.modules).toHaveLength(1)
    expect(manifest.modules[0].versions.map(v => v.id).sort()).toEqual(['ver-en-2', 'ver-es-1'])
    expect(manifest).toMatchObject({ generated_at: NOW.toISOString(), tenant_id: 't1', device: { id: 'dev-1', name: 'Line 3' }, truncated: false })
  })

  it('never sends the answer key in the clear', async () => {
    const manifest = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    // everything except the encrypted key and the key that opens it
    const wire = JSON.stringify(manifest, (key, value) => (key === 'answer_key' || key === 'answer_key_secret' ? undefined : value))
    expect(wire).not.toContain('is_correct')
    expect(wire).not.toContain('Because') // explanations only inside the encrypted blob
    expect(wire).not.toContain('Notify first.')
    const en = manifest.modules[0].versions.find(v => v.id === 'ver-en-2')!
    expect(en.questions.flatMap(q => q.answers.map(a => Object.keys(a).sort().join()))).toEqual(['answer_text,id,sort_order', 'answer_text,id,sort_order', 'answer_text,id,sort_order', 'answer_text,id,sort_order'])
  })

  it('lists questions and answers in the order the worker should see them', async () => {
    const manifest = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    const en = manifest.modules[0].versions.find(v => v.id === 'ver-en-2')!
    expect(en.questions.map(q => q.id)).toEqual(['q0', 'q1'])
    expect(en.questions[1].answers.map(a => a.id)).toEqual(['a1', 'a2'])
  })

  it('gives a device a key that decrypts to something scoreStrikeQuiz grades exactly like the server', async () => {
    const manifest = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    const en = manifest.modules[0].versions.find(v => v.id === 'ver-en-2')!
    const payload = decrypt(en.answer_key_secret, en.answer_key)
    expect(payload.explanations).toEqual({ q1: 'Notify first.' })

    const grade = (answers: Record<string, string[]>) => scoreStrikeQuiz({ questions: payload.questions, answersByQuestionId: answers, passingScore: en.passing_score })
    expect(grade({ q0: ['f'], q1: ['a1'] })).toMatchObject({ scorePercent: 100, passed: true })
    expect(grade({ q0: ['t'], q1: ['a1'] })).toMatchObject({ scorePercent: 33, passed: false, missedQuestionIds: ['q0'] })
  })

  it('binds each key to its device: another tablet cannot open this one’s answer key', async () => {
    const a = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    const b = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device: { ...device, id: 'dev-2' }, keyScope: 'dev-2', now: NOW })
    const va = a.modules[0].versions.find(v => v.id === 'ver-en-2')!
    const vb = b.modules[0].versions.find(v => v.id === 'ver-en-2')!
    expect(va.answer_key_secret).not.toBe(vb.answer_key_secret)
    expect(() => decrypt(vb.answer_key_secret, va.answer_key)).toThrow()
  })

  it('lists every media path the module needs, so the tablet can download it in full', async () => {
    const manifest = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    expect(manifest.modules[0].versions[0].asset_paths).toEqual(['global/loto-101/v1/s1.jpg'])
  })

  it('gives a shared tablet a roster to pick from, and a signed-in tablet none', async () => {
    const shared = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    expect(shared.roster).toEqual([
      { member_id: 'm1', name: 'Mari', identifiers: [{ type: 'badge_id', hash: 'h-badge-1' }] },
      { member_id: 'm2', name: 'Sam Ito', identifiers: [] },
    ])
    const personal = await buildOfflineManifest(fakeAdmin(baseRows()).admin, { tenantId: 't1', device: null, keyScope: 'user:u1', now: NOW })
    expect(personal.roster).toBeNull()
    expect(personal.device).toBeNull()
  })

  it('narrows the roster to the line or site the tablet is scoped to, within this tenant', async () => {
    const { admin, filters } = fakeAdmin(baseRows())
    await buildOfflineManifest(admin, { tenantId: 't1', device: { ...device, department: 'Packaging', siteLabel: 'Plant 2' }, keyScope: 'dev-1', now: NOW })
    expect(filters).toEqual(expect.arrayContaining([['members', 'tenant_id', 't1'], ['members', 'status', 'active'], ['members', 'department', 'Packaging'], ['members', 'site_label', 'Plant 2'], ['member_identifier_hashes', 'tenant_id', 't1']]))
  })

  it('skips a version whose stored content no longer parses rather than shipping something unplayable', async () => {
    const rows = baseRows()
    rows.strike_module_versions = [{ ...(rows.strike_module_versions[1] as object), content: { blocks: 'broken' } }]
    const manifest = await buildOfflineManifest(fakeAdmin(rows).admin, { tenantId: 't1', device, keyScope: 'dev-1', now: NOW })
    expect(manifest.modules).toEqual([])
  })
})
