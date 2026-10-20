import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { gateOk, gateRejects, jsonRequest, mockState, resetMocks, storageListMock } from './_helpers'
import { POST as planImport } from '@/app/api/superadmin/strike/import/plan/route'
import { POST as commitImport } from '@/app/api/superadmin/strike/import/route'

// The LOTO 101 seed stands in for a package Claude produced. Only module.json
// is sent (one language) so the row counts below stay easy to read.
const SEED_DIR = join(__dirname, '../../../../../services/learning-studio/seed/loto-101')

function packageBody() {
  const names = readdirSync(SEED_DIR).filter(name => !/^module(\.[a-z]{2})?\.json$/.test(name))
  return {
    documents: [{ name: 'module.json', json: JSON.parse(readFileSync(join(SEED_DIR, 'module.json'), 'utf8')) as unknown }],
    files: names.map(name => ({ name, size: statSync(join(SEED_DIR, name)).size })),
  }
}

/** Every object the plan expects, as storage.list() would report them. */
function bucketHasEverything() {
  const names = readdirSync(SEED_DIR).filter(name => !name.endsWith('.json'))
  storageListMock.mockResolvedValue({ data: names.map(name => ({ name })), error: null })
}

/** The global library's media scan finds nothing in use (one empty page). */
function noMediaInUse() {
  mockState.queue('strike_module_versions', { data: [], error: null })
}

/** A published global version of another module already serving one of the package's files. */
function publishedVersionUses(path: string) {
  const blocks = JSON.parse(readFileSync(join(SEED_DIR, 'module.json'), 'utf8')).content.blocks as Array<{ kind: string; image?: { path: string } }>
  const scene = { ...blocks.find(b => b.kind === 'motion_scene')!, image: { ...blocks.find(b => b.kind === 'motion_scene')!.image!, path } }
  mockState.queue('strike_module_versions',
    { data: [{ id: 'old-v1', module_id: 'other-module', status: 'published', content: { blocks: [scene] }, download_path: null }], error: null },
    { data: [], error: null })
}

describe('POST /api/superadmin/strike/import/plan', () => {
  beforeEach(() => { resetMocks(); gateOk() })

  it('returns 401 when the gate rejects', async () => {
    gateRejects(401, 'Missing bearer token')
    const res = await planImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(401)
  })

  it('returns 400 for a body that is not a package', async () => {
    const res = await planImport(jsonRequest('POST', { hello: 'world' }))
    expect(res.status).toBe(400)
  })

  it('returns 422 with the package issues when it cannot be imported', async () => {
    const body = packageBody()
    body.files = body.files.filter(f => f.name !== 'scene-01-why.jpg')
    const res = await planImport(jsonRequest('POST', body))
    expect(res.status).toBe(422)
    const json = await res.json()
    expect(json.issues).toEqual(['module.json: media file "scene-01-why.jpg" is not in the package.'])
  })

  it('describes a fresh module as a create and lists the uploads', async () => {
    const res = await planImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.decision).toEqual({ moduleAction: 'create', versions: [{ locale: 'en', action: 'create', versionNumber: 1 }], conflicts: [] })
    expect(json.uploads).toContain('global/loto-101/v1/s1-why.mp3')
    expect(mockState.inserts).toHaveLength(0)
  })

  // Uploads overwrite, and the package names its own folder. Reusing a
  // folder a published version serves would swap the media learners were
  // credited against, so the plan refuses before anything is uploaded.
  it('refuses a package whose uploads would overwrite media a published version serves', async () => {
    publishedVersionUses('global/loto-101/v1/scene-01-why.jpg')
    const res = await planImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.decision.conflicts).toEqual(['global/loto-101/v1/scene-01-why.jpg'])
  })

  it('refuses a language that is already published without writing anything', async () => {
    mockState.queue('strike_modules', {
      data: { id: 'mod-1', status: 'published', strike_module_versions: [{ id: 'v1', version_number: 1, status: 'published', locale: 'en' }] },
      error: null,
    })
    const res = await planImport(jsonRequest('POST', packageBody()))
    const json = await res.json()
    expect(json.decision.versions[0].action).toBe('refused')
    expect(mockState.inserts).toHaveLength(0)
  })
})

describe('POST /api/superadmin/strike/import', () => {
  beforeEach(() => { resetMocks(); gateOk('super-1') })

  it('returns 409 and the missing paths when media is not in the bucket yet', async () => {
    const res = await commitImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(409)
    const json = await res.json()
    expect(json.missing).toContain('global/loto-101/v1/scene-01-why.jpg')
    expect(mockState.inserts).toHaveLength(0)
  })

  it('creates the module, a draft version and the quiz once every file is present', async () => {
    bucketHasEverything()
    mockState.queue('strike_modules', { data: null, error: null })                 // slug lookup: new module
    mockState.queue('strike_modules', { data: { id: 'mod-new' }, error: null })    // insert
    noMediaInUse()
    mockState.queue('strike_module_versions', { data: { id: 'ver-new' }, error: null })
    mockState.queue('strike_quiz_questions', { data: null, error: null })          // delete
    mockState.queue('strike_quiz_questions', {                                     // insert
      data: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, sort_order: i })),
      error: null,
    })

    const res = await commitImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json).toEqual({
      moduleId: 'mod-new',
      moduleAction: 'create',
      versions: [{ locale: 'en', versionId: 'ver-new', versionNumber: 1, action: 'create' }],
    })

    const moduleInsert = mockState.inserts.find(i => i.table === 'strike_modules')!.payload as Record<string, unknown>
    expect(moduleInsert).toMatchObject({ slug: 'loto-101-control-hazardous-energy', library_scope: 'global', status: 'in_review', created_by: 'super-1' })

    const versionInsert = mockState.inserts.find(i => i.table === 'strike_module_versions')!.payload as Record<string, unknown>
    expect(versionInsert).toMatchObject({ module_id: 'mod-new', version_number: 1, status: 'draft', locale: 'en', title: null, passing_score: 80 })
    const content = versionInsert.content as { blocks: Array<{ kind: string; image?: { path: string; approved_by: string | null } }> }
    expect(content.blocks[0]!.image!.path).toBe('global/loto-101/v1/scene-01-why.jpg')
    expect(content.blocks[0]!.image!.approved_by).toBeNull()

    const questionInsert = mockState.inserts.find(i => i.table === 'strike_quiz_questions')!.payload as unknown[]
    expect(questionInsert).toHaveLength(10)
    const answerInsert = mockState.inserts.find(i => i.table === 'strike_quiz_answers')!.payload as Array<{ question_id: string; is_correct: boolean }>
    expect(answerInsert.filter(a => a.question_id === 'q0')).toHaveLength(4)
    expect(answerInsert.some(a => a.is_correct)).toBe(true)
  })

  it('updates an existing draft in place and replaces its quiz', async () => {
    bucketHasEverything()
    mockState.queue('strike_modules', {
      data: { id: 'mod-1', status: 'in_review', strike_module_versions: [{ id: 'v1', version_number: 1, status: 'draft', locale: 'en' }] },
      error: null,
    })
    noMediaInUse()
    mockState.queue('strike_module_versions', { data: [{ id: 'v1' }], error: null }) // guarded update matched one row
    mockState.queue('strike_quiz_questions', { data: null, error: null })
    mockState.queue('strike_quiz_questions', { data: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, sort_order: i })), error: null })

    const res = await commitImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(200)
    // The status-guarded version update runs first: it is the step that can still be refused.
    expect(mockState.updates.map(u => u.table)).toEqual(['strike_module_versions', 'strike_modules'])
    expect(mockState.deletes.map(d => d.table)).toEqual(['strike_quiz_questions'])
    expect(mockState.inserts.map(i => i.table)).toEqual(['strike_quiz_questions', 'strike_quiz_answers'])
  })

  it('refuses when the draft was published mid-import', async () => {
    bucketHasEverything()
    mockState.queue('strike_modules', {
      data: { id: 'mod-1', status: 'in_review', strike_module_versions: [{ id: 'v1', version_number: 1, status: 'draft', locale: 'en' }] },
      error: null,
    })
    noMediaInUse()
    mockState.queue('strike_module_versions', { data: [], error: null }) // the status-guarded update matched nothing
    const res = await commitImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(409)
    expect(mockState.inserts).toHaveLength(0)
    expect(mockState.updates.map(u => u.table)).toEqual(['strike_module_versions'])
  })

  it('imports English and Spanish as versions 1 and 2, the translation carrying its own title', async () => {
    bucketHasEverything()
    const body = packageBody()
    body.documents.push({ name: 'module.es.json', json: JSON.parse(readFileSync(join(SEED_DIR, 'module.es.json'), 'utf8')) as unknown })
    mockState.queue('strike_modules', { data: null, error: null })
    mockState.queue('strike_modules', { data: { id: 'mod-new' }, error: null })
    noMediaInUse()
    mockState.queue('strike_module_versions', { data: { id: 'ver-en' }, error: null })
    mockState.queue('strike_quiz_questions', { data: null, error: null })
    mockState.queue('strike_quiz_questions', { data: Array.from({ length: 10 }, (_, i) => ({ id: `q${i}`, sort_order: i })), error: null })
    mockState.queue('strike_module_versions', { data: { id: 'ver-es' }, error: null })
    mockState.queue('strike_quiz_questions', { data: null, error: null })
    mockState.queue('strike_quiz_questions', { data: Array.from({ length: 10 }, (_, i) => ({ id: `s${i}`, sort_order: i })), error: null })

    const res = await commitImport(jsonRequest('POST', body))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.versions).toEqual([
      { locale: 'en', versionId: 'ver-en', versionNumber: 1, action: 'create' },
      { locale: 'es', versionId: 'ver-es', versionNumber: 2, action: 'create' },
    ])
    const versionInserts = mockState.inserts.filter(i => i.table === 'strike_module_versions').map(i => i.payload as Record<string, unknown>)
    expect(versionInserts.map(v => [v.version_number, v.locale, v.title])).toEqual([[1, 'en', null], [2, 'es', 'LOTO 101: Control de energía peligrosa']])
  })

  it('writes nothing when an upload path is in use by a published version', async () => {
    bucketHasEverything()
    mockState.queue('strike_modules', { data: null, error: null })
    publishedVersionUses('global/loto-101/v1/s1-why.mp3')
    const res = await commitImport(jsonRequest('POST', packageBody()))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/global\/loto-101\/v1\/s1-why\.mp3/)
    expect(mockState.inserts).toHaveLength(0)
    expect(mockState.updates).toHaveLength(0)
  })
})
