import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The life of a STRIKE package in the global library, through the real plan
// and import routes. Only the outermost I/O is replaced: an in-memory table
// store stands in for Postgres and a Set of object keys for the strike-media
// bucket. The LOTO 101 seed (English + Spanish) is the package.

type Row = Record<string, unknown>
const db = { tables: new Map<string, Row[]>(), bucket: new Set<string>(), ids: 0 }
const table = (name: string) => db.tables.get(name) ?? (db.tables.set(name, []), db.tables.get(name)!)

function query(name: string) {
  const filters: Array<(row: Row) => boolean> = []
  let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: unknown = null
  let range: [number, number] | null = null
  const run = () => {
    const rows = table(name)
    if (op === 'insert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: `${name}-${++db.ids}`, ...(r as Row) }))
      rows.push(...list)
      return { data: Array.isArray(payload) ? list : list[0], error: null }
    }
    const matched = rows.filter(r => filters.every(f => f(r)))
    if (op === 'update') { matched.forEach(r => Object.assign(r, payload)); return { data: matched, error: null } }
    if (op === 'delete') {
      db.tables.set(name, rows.filter(r => !matched.includes(r)))
      // strike_quiz_answers.question_id is "on delete cascade" (migration 114).
      if (name === 'strike_quiz_questions') db.tables.set('strike_quiz_answers', table('strike_quiz_answers').filter(a => !matched.some(q => q.id === a.question_id)))
      return { data: null, error: null }
    }
    const withVersions = name === 'strike_modules'
      ? matched.map(m => ({ ...m, strike_module_versions: table('strike_module_versions').filter(v => v.module_id === m.id) }))
      : matched
    return { data: range ? withVersions.slice(range[0], range[1] + 1) : withVersions, error: null }
  }
  const chain: Record<string, unknown> = {
    select: () => chain,
    order: () => chain,
    insert: (p: unknown) => { op = 'insert'; payload = p; return chain },
    update: (p: unknown) => { op = 'update'; payload = p; return chain },
    delete: () => { op = 'delete'; return chain },
    eq: (col: string, value: unknown) => { filters.push(r => r[col] === value); return chain },
    in: (col: string, values: unknown[]) => { filters.push(r => values.includes(r[col])); return chain },
    range: (from: number, to: number) => { range = [from, to]; return Promise.resolve(run()) },
    single: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: null } },
    maybeSingle: async () => { const r = run(); return { data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: null } },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve(run()).then(resolve),
  }
  return chain
}

vi.mock('@/lib/auth/superadmin', () => ({ requireSuperadmin: async () => ({ ok: true, userId: 'super-1' }) }))
vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({
    from: (name: string) => query(name),
    storage: {
      from: () => ({
        list: async (folder: string) => ({
          data: [...db.bucket].filter(k => k.startsWith(`${folder}/`) && !k.slice(folder.length + 1).includes('/')).map(k => ({ name: k.slice(folder.length + 1) })),
          error: null,
        }),
      }),
    },
  }),
}))

import { POST as plan } from '@/app/api/superadmin/strike/import/plan/route'
import { POST as commit } from '@/app/api/superadmin/strike/import/route'

const SEED_DIR = join(__dirname, '../../../../services/learning-studio/seed/loto-101')
const isDoc = (n: string) => /^module(\.[a-z]{2})?\.json$/.test(n)

function seedPackage(edit: (doc: Row) => void = () => {}) {
  const names = readdirSync(SEED_DIR)
  return {
    documents: names.filter(isDoc).map(name => {
      const json = JSON.parse(readFileSync(join(SEED_DIR, name), 'utf8')) as Row
      edit(json)
      return { name, json }
    }),
    files: names.filter(n => !isDoc(n)).map(name => ({ name, size: statSync(join(SEED_DIR, name)).size })),
  }
}

const call = async (handler: (r: Request) => Promise<Response>, body: unknown) => {
  const res = await handler(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))
  return { status: res.status, json: await res.json() }
}

/** What the drop zone does after a clean plan: upload every listed path. */
const uploadAll = (uploads: string[]) => uploads.forEach(path => db.bucket.add(path))

const versions = () => table('strike_module_versions')
const questionsOf = (versionId: unknown) => table('strike_quiz_questions').filter(q => q.module_version_id === versionId)

beforeEach(() => {
  db.tables = new Map()
  db.bucket = new Set()
  db.ids = 0
})

describe('a STRIKE package from first drop to a second edition', () => {
  it('imports, accepts a fixed re-drop, then protects the published edition', async () => {
    // 1. First drop: the plan creates a module with English v1 and Spanish v2.
    const first = await call(plan, seedPackage())
    expect(first.status).toBe(200)
    expect(first.json.decision).toMatchObject({
      moduleAction: 'create',
      versions: [{ locale: 'en', action: 'create', versionNumber: 1 }, { locale: 'es', action: 'create', versionNumber: 2 }],
      conflicts: [],
    })

    // 2. Committing before the upload finished writes nothing.
    const early = await call(commit, seedPackage())
    expect(early.status).toBe(409)
    expect(table('strike_modules')).toHaveLength(0)

    // 3. Upload, commit: drafts with the quiz, and no approvals carried in.
    uploadAll(first.json.uploads)
    const imported = await call(commit, seedPackage())
    expect(imported.status).toBe(201)
    expect(table('strike_modules')).toHaveLength(1)
    expect(versions().map(v => [v.version_number, v.locale, v.status])).toEqual([[1, 'en', 'draft'], [2, 'es', 'draft']])
    for (const v of versions()) {
      expect(questionsOf(v.id)).toHaveLength(10)
      expect(JSON.stringify(v.content)).not.toMatch(/"approved_by":"[^"]/)
    }
    const answersBefore = table('strike_quiz_answers').length

    // 4. A reviewer asks for a fix; re-dropping updates both drafts in place.
    const fixed = seedPackage(doc => { doc.passing_score = 90 })
    const replan = await call(plan, fixed)
    expect(replan.json.decision.versions.map((v: { action: string }) => v.action)).toEqual(['update', 'update'])
    expect(replan.json.decision.conflicts).toEqual([])
    const updated = await call(commit, fixed)
    expect(updated.status).toBe(200)
    expect(versions()).toHaveLength(2)
    expect(versions().map(v => v.passing_score)).toEqual([90, 90])
    expect(table('strike_quiz_questions')).toHaveLength(20)
    expect(table('strike_quiz_answers')).toHaveLength(answersBefore)

    // 5. Both editions are published; learners now earn completions on them.
    versions().forEach(v => { v.status = 'published' })
    const servedPaths = JSON.stringify(versions().map(v => v.content))

    // 6. The same package dropped again is refused, before anything uploads:
    //    every language is published, and its files are the published ones.
    const again = await call(plan, seedPackage())
    expect(again.json.decision.versions.map((v: { action: string }) => v.action)).toEqual(['refused', 'refused'])
    expect(again.json.decision.conflicts.length).toBeGreaterThan(0)
    expect(again.json.decision.conflicts).toContain('global/loto-101/v1/scene-01-why.jpg')

    // 7. The studio opens a second English edition, and the author bumps the
    //    media folder. Now the drop updates that draft and touches nothing published.
    versions().push({ id: 'v3', module_id: versions()[0]!.module_id, version_number: 3, locale: 'en', status: 'draft' })
    const edition2 = seedPackage(doc => { doc.media_prefix = 'global/loto-101/v2' })
    edition2.documents = edition2.documents.filter(d => d.name === 'module.json')
    const plan2 = await call(plan, edition2)
    expect(plan2.json.decision).toMatchObject({ versions: [{ locale: 'en', action: 'update', versionId: 'v3' }], conflicts: [] })
    uploadAll(plan2.json.uploads)
    const committed2 = await call(commit, edition2)
    expect(committed2.status).toBe(200)
    expect(JSON.stringify(versions().filter(v => v.status === 'published').map(v => v.content))).toBe(servedPaths)
    expect(JSON.stringify(versions().find(v => v.id === 'v3')!.content)).toContain('global/loto-101/v2/')
  })

  it("won't let a different module's package reuse this module's media folder", async () => {
    const first = await call(plan, seedPackage())
    uploadAll(first.json.uploads)
    expect((await call(commit, seedPackage())).status).toBe(201)

    const impostor = seedPackage(doc => { doc.slug = 'loto-102-group-lockout'; doc.title = 'LOTO 102' })
    const planned = await call(plan, impostor)
    expect(planned.json.decision.moduleAction).toBe('create')
    expect(planned.json.decision.conflicts).toContain('global/loto-101/v1/s1-why.mp3')
    expect((await call(commit, impostor)).status).toBe(409)
    expect(table('strike_modules')).toHaveLength(1)
  })
})
