import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseStrikePackageInput, readStrikePackage, type StrikePackageInput } from '@/lib/strike/package'

// The LOTO 101 seed is the reference module: a package the Media Studio
// produced must read cleanly, and the plan must match what
// `import_seed_module` would have uploaded.
const SEED_DIR = join(__dirname, '../../../../../services/learning-studio/seed/loto-101')

function seedInput(extraFiles: string[] = []): StrikePackageInput {
  const names = readdirSync(SEED_DIR)
  const documents = names
    .filter(name => /^module(\.[a-z]{2})?\.json$/.test(name))
    .map(name => ({ name, json: JSON.parse(readFileSync(join(SEED_DIR, name), 'utf8')) as unknown }))
  const files = names
    .filter(name => !/^module(\.[a-z]{2})?\.json$/.test(name))
    .map(name => ({ name, size: statSync(join(SEED_DIR, name)).size }))
    .concat(extraFiles.map(name => ({ name, size: 1 })))
  return { documents, files }
}

function moduleJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base = JSON.parse(readFileSync(join(SEED_DIR, 'module.json'), 'utf8')) as Record<string, unknown>
  return { ...base, ...overrides }
}

describe('readStrikePackage on the LOTO 101 seed', () => {
  it('plans an English and a Spanish version with every referenced file queued for upload', () => {
    const read = readStrikePackage(seedInput(['module.mp4', 'module.es.mp4']))
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const { plan } = read

    expect(plan.slug).toBe('loto-101-control-hazardous-energy')
    expect(plan.mediaPrefix).toBe('global/loto-101/v1')
    expect(plan.title).toBe('LOTO 101: Control of Hazardous Energy')
    expect(plan.versions.map(v => v.locale)).toEqual(['en', 'es'])
    expect(plan.versions[1]!.title).toMatch(/energía peligrosa/)

    const names = plan.uploads.map(u => u.name)
    expect(names).toContain('scene-01-why.jpg')
    expect(names).toContain('s1-why.mp3')
    expect(names).toContain('s1-why.es.vtt')
    expect(names).toContain('module.mp4')
    expect(names).toContain('module.es.mp4')
    expect(plan.versions[0]!.downloadPath).toBe('global/loto-101/v1/module.mp4')
    expect(plan.versions[1]!.downloadPath).toBe('global/loto-101/v1/module.es.mp4')
    // media.json is studio bookkeeping, not player media.
    expect(plan.ignored).toEqual(['media.json'])
    expect(plan.uploads.find(u => u.name === 's1-why.vtt')!.contentType).toBe('text/vtt')
  })

  it('rewrites bare file names to bucket paths and clears every AI approval', () => {
    const read = readStrikePackage(seedInput())
    if (!read.ok) throw new Error(read.issues.join('\n'))
    const scene = read.plan.versions[0]!.content.blocks[0]
    if (scene.kind !== 'motion_scene' || !scene.image || !scene.narration) throw new Error('expected a narrated scene')
    expect(scene.image.path).toBe('global/loto-101/v1/scene-01-why.jpg')
    expect(scene.narration.audio_path).toBe('global/loto-101/v1/s1-why.mp3')
    expect(scene.narration.captions_path).toBe('global/loto-101/v1/s1-why.vtt')
    expect(scene.image.approved_by).toBeNull()
    expect(scene.narration.approved_at).toBeNull()
    expect(scene.image.ai_generated).toBe(true)
  })

  it('keeps the quiz with its answer key', () => {
    const read = readStrikePackage(seedInput())
    if (!read.ok) throw new Error(read.issues.join('\n'))
    const questions = read.plan.versions[0]!.questions
    expect(questions).toHaveLength(10)
    expect(questions[0]!.answers.filter(a => a.correct)).toHaveLength(1)
  })
})

describe('readStrikePackage refusals', () => {
  it('names each media file the package is missing', () => {
    const input = seedInput()
    input.files = input.files.filter(f => f.name !== 'scene-02-energy.jpg' && f.name !== 's3-roles.mp3')
    const read = readStrikePackage(input)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.issues).toContain('module.json: media file "scene-02-energy.jpg" is not in the package.')
    expect(read.issues).toContain('module.json: media file "s3-roles.mp3" is not in the package.')
  })

  it('leaves paths that already carry a folder alone', () => {
    const doc = moduleJson()
    const content = doc.content as { blocks: Array<Record<string, unknown>> }
    content.blocks[0]!.image = { path: 'global/shared/intro.jpg', alt: 'x', ai_generated: false }
    const input = seedInput()
    input.documents = [{ name: 'module.json', json: doc }]
    const read = readStrikePackage(input)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    const scene = read.plan.versions[0]!.content.blocks[0]
    expect(scene.kind === 'motion_scene' && scene.image?.path).toBe('global/shared/intro.jpg')
    expect(read.plan.uploads.some(u => u.bucketPath === 'global/shared/intro.jpg')).toBe(false)
  })

  it('rejects a document whose locale disagrees with its file name', () => {
    const input = seedInput()
    input.documents = [{ name: 'module.json', json: moduleJson({ locale: 'es' }) }]
    const read = readStrikePackage(input)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.issues[0]).toMatch(/does not match the file name/)
  })

  it('rejects translations that point at a different module', () => {
    const input = seedInput()
    const spanish = input.documents.find(d => d.name === 'module.es.json')!
    spanish.json = { ...(spanish.json as object), slug: 'loto-999' }
    const read = readStrikePackage(input)
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.issues[0]).toMatch(/slug and media_prefix must match/)
  })

  it('rejects tenant-scoped packages and bad prefixes', () => {
    const scoped = readStrikePackage({ ...seedInput(), documents: [{ name: 'module.json', json: moduleJson({ library_scope: 'tenant' }) }] })
    expect(scoped.ok).toBe(false)
    const prefixed = readStrikePackage({ ...seedInput(), documents: [{ name: 'module.json', json: moduleJson({ media_prefix: 'tenant-x/loto/v1' }) }] })
    expect(prefixed.ok).toBe(false)
    if (!prefixed.ok) expect(prefixed.issues[0]).toMatch(/media_prefix/)
  })

  it('rejects a multiple-choice question without exactly one correct answer', () => {
    const doc = moduleJson()
    const questions = doc.questions as Array<{ answers: Array<{ correct: boolean }> }>
    questions[0]!.answers.forEach(a => { a.correct = false })
    const read = readStrikePackage({ ...seedInput(), documents: [{ name: 'module.json', json: doc }] })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.issues[0]).toMatch(/question 1: needs exactly one correct answer/)
  })

  it('reports block problems through parseStrikeContent', () => {
    const doc = moduleJson()
    const content = doc.content as { blocks: Array<Record<string, unknown>> }
    content.blocks[0]!.kind = 'hologram'
    const read = readStrikePackage({ ...seedInput(), documents: [{ name: 'module.json', json: doc }] })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.issues[0]).toMatch(/block 1: Unknown block kind/)
  })
})

describe('parseStrikePackageInput', () => {
  it('accepts the wire shape and nothing else', () => {
    expect(parseStrikePackageInput(seedInput())).not.toBeNull()
    expect(parseStrikePackageInput(null)).toBeNull()
    expect(parseStrikePackageInput({ documents: [], files: [] })).toBeNull()
    expect(parseStrikePackageInput({ documents: [{ name: 'notes.json', json: {} }], files: [] })).toBeNull()
    expect(parseStrikePackageInput({ documents: [{ name: 'module.json', json: {} }], files: [{ name: '../x.mp3', size: 1 }] })).toBeNull()
    expect(parseStrikePackageInput({ documents: [{ name: 'module.json', json: {} }], files: [{ name: 'x.mp3', size: -1 }] })).toBeNull()
  })
})
