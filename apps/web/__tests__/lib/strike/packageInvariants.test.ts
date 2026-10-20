import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { strikeContentAssetPaths } from '@soteria/core/strikeContent'
import { parseStrikePackageInput, readStrikePackage, type StrikePackageInput, type StrikePackagePlan } from '@/lib/strike/package'
import { decideImport, type ExistingModule } from '@/lib/strike/packageImport'

// Invariant sweeps for the package importer. Each case mutates the LOTO 101
// seed (the reference package) in one or more ways, and every plan that reads
// ok must be one the database will accept and the player can serve. A plan
// that reads ok but fails at insert is the expensive kind of bug: it fails
// after the operator has uploaded every file.

const SEED_DIR = join(__dirname, '../../../../../services/learning-studio/seed/loto-101')
const SEED_NAMES = readdirSync(SEED_DIR)
const isDoc = (name: string) => /^module(\.[a-z]{2})?\.json$/.test(name)
const seedDoc = (name: string) => JSON.parse(readFileSync(join(SEED_DIR, name), 'utf8')) as Record<string, unknown>
const seedFiles = () => SEED_NAMES.filter(n => !isDoc(n)).map(name => ({ name, size: statSync(join(SEED_DIR, name)).size }))

/** Deterministic PRNG (mulberry32) so a failing case reproduces. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Values the JSON type permits that an author (or a tool) could plausibly write.
const NUMBERS = [undefined, null, 0, 1, 79.5, 80, 100, 101, -5, Number.MAX_SAFE_INTEGER, '80', true]
const STRINGS = [undefined, null, '', '  ', 'ok', 'x'.repeat(161), 'x'.repeat(201), 42]
const PREFIXES = ['global/loto-101/v1', '/global/loto-101/v1/', 'global/loto-101', 'tenant/x/v1', 'global/../x/v1', 'global/Loto/v1']
const PATHS = ['scene-01-why.jpg', 'missing.jpg', 'global/shared/x.jpg', 'global/../t/x.jpg', 'tenant/x.jpg', 'global//x.jpg', '../x.jpg']

type Mutation = (doc: Record<string, unknown>, pick: <T>(xs: readonly T[]) => T) => string

const MUTATIONS: Mutation[] = [
  (d, pick) => { const v = pick(NUMBERS); d.passing_score = v; return `passing_score=${String(v)}` },
  (d, pick) => { const v = pick(NUMBERS); d.retake_limit = v; return `retake_limit=${String(v)}` },
  (d, pick) => { const v = pick(NUMBERS); d.validity_days = v; return `validity_days=${String(v)}` },
  (d, pick) => { const v = pick(NUMBERS); d.estimated_minutes = v; return `estimated_minutes=${String(v)}` },
  (d, pick) => { const v = pick(STRINGS); d.title = v; return `title=${String(v).slice(0, 12)}` },
  (d, pick) => { const v = pick(PREFIXES); d.media_prefix = v; return `media_prefix=${v}` },
  (d, pick) => { const v = pick(['loto-101-control-hazardous-energy', 'x', 'UPPER', 'a'.repeat(81), '']); d.slug = v; return `slug=${v.slice(0, 12)}` },
  (d, pick) => { const v = pick(PATHS); firstScene(d).image.path = v; return `image=${v}` },
  (d, pick) => { const v = pick(PATHS); firstScene(d).narration.audio_path = v; return `audio=${v}` },
  (d, pick) => { const tags = pick([undefined, [], ['A', ' b ', 3], Array.from({ length: 20 }, (_, i) => `t${i}`)]); d.tags = tags; return `tags=${JSON.stringify(tags)?.slice(0, 12)}` },
  (d, pick) => { const v = pick(['multiple_choice', 'true_false', 'select_all', 'essay']); (d.questions as Array<Record<string, unknown>>)[0]!.question_type = v; return `q1type=${v}` },
  (d, pick) => { const n = pick([0, 1, 2]); const q = (d.questions as Array<{ answers: Array<{ correct: boolean }> }>)[0]!; q.answers.forEach((a, i) => { a.correct = i < n }); return `q1correct=${n}` },
  (d, pick) => { const v = pick(['global', 'tenant', undefined]); d.library_scope = v; return `scope=${String(v)}` },
  (d, pick) => { const v = pick(['en', 'es', 'fr', undefined]); d.locale = v; return `locale=${String(v)}` },
]

function firstScene(d: Record<string, unknown>) {
  return ((d.content as { blocks: Array<Record<string, unknown>> }).blocks.find(b => b.kind === 'motion_scene') as unknown) as {
    image: { path: string }; narration: { audio_path: string }
  }
}

/** Everything a plan that read ok must satisfy; returns the broken rules. */
function planViolations(plan: StrikePackagePlan, input: StrikePackageInput): string[] {
  const broken: string[] = []
  const isInt = (n: number | null, lo: number, hi: number) => n === null || (Number.isInteger(n) && n >= lo && n <= hi)
  // Database constraints (migrations 114, 301).
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(plan.slug)) broken.push('slug shape')
  if (!plan.title || plan.title.length > 160) broken.push('module title length')
  if (!isInt(plan.estimatedMinutes, 1, 60)) broken.push('estimated_minutes int 1..60')
  if (plan.tags.length > 12 || plan.tags.some(t => t !== t.trim().toLowerCase() || !t)) broken.push('tags normalized')
  for (const v of plan.versions) {
    if (!isInt(v.passingScore, 0, 100)) broken.push(`${v.locale} passing_score int 0..100`)
    if (!isInt(v.retakeLimit, 1, Number.MAX_SAFE_INTEGER)) broken.push(`${v.locale} retake_limit`)
    if (!isInt(v.validityDays, 1, Number.MAX_SAFE_INTEGER)) broken.push(`${v.locale} validity_days`)
    if (v.title.length > 200) broken.push(`${v.locale} version title length`)
    // Every path the player will sign is global, plain, and either uploaded
    // by this import or listed for the existence check.
    const uploads = new Set(plan.uploads.map(u => u.bucketPath))
    const external = new Set(plan.externalMedia)
    for (const path of [...strikeContentAssetPaths(v.content), ...(v.downloadPath ? [v.downloadPath] : [])]) {
      const segments = path.split('/')
      if (segments[0] !== 'global' || segments.some(s => s === '' || s === '.' || s === '..')) broken.push(`unsafe path ${path}`)
      if (!uploads.has(path) && !external.has(path)) broken.push(`unchecked path ${path}`)
    }
    // A package from a tool never carries a person's sign-off.
    if (JSON.stringify(v.content).match(/"approved_by":"[^"]/)) broken.push(`${v.locale} kept an approval`)
    if (v.questions.length === 0) broken.push(`${v.locale} no questions`)
  }
  for (const upload of plan.uploads) {
    if (!upload.bucketPath.startsWith(`${plan.mediaPrefix}/`)) broken.push(`upload outside prefix ${upload.bucketPath}`)
    if (!input.files.some(f => f.name === upload.name)) broken.push(`upload of a file not in the package ${upload.name}`)
  }
  if (!plan.mediaPrefix.startsWith('global/') || plan.mediaPrefix.split('/').some(s => s === '..' || s === '.')) broken.push('media prefix')
  if (new Set(plan.versions.map(v => v.locale)).size !== plan.versions.length) broken.push('duplicate locale')
  return broken
}

describe('readStrikePackage invariant sweep', () => {
  it('every package that reads ok is one the database accepts and the player can serve', () => {
    const CASES = 4000
    const random = rng(20261020)
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(random() * xs.length)]!
    const violations: string[] = []
    let accepted = 0
    let executed = 0
    for (let i = 0; i < CASES; i++) {
      const en = seedDoc('module.json')
      const es = seedDoc('module.es.json')
      const labels: string[] = []
      const mutations = 1 + Math.floor(random() * 3)
      for (let m = 0; m < mutations; m++) labels.push(pick(MUTATIONS)(random() < 0.7 ? en : es, pick))
      const documents = random() < 0.25 ? [{ name: 'module.json', json: en }] : [{ name: 'module.json', json: en }, { name: 'module.es.json', json: es }]
      const files = random() < 0.2 ? seedFiles().filter((_, idx) => idx % 7 !== 0) : seedFiles()
      const input = { documents, files }
      // The wire parser must accept anything the reader is then given.
      if (!parseStrikePackageInput(JSON.parse(JSON.stringify(input)))) { executed++; continue }
      const read = readStrikePackage(input)
      executed++
      if (!read.ok) {
        if (read.issues.length === 0) violations.push(`#${i} refused with no reason: ${labels.join(' ')}`)
        continue
      }
      accepted++
      for (const broken of planViolations(read.plan, input)) violations.push(`#${i} ${broken} :: ${labels.join(' ')}`)
      // Same input, same plan.
      if (JSON.stringify(readStrikePackage(input)) !== JSON.stringify(read)) violations.push(`#${i} not deterministic`)
    }
    expect(executed).toBe(CASES)
    expect(accepted).toBeGreaterThan(CASES / 10)
    expect([...new Set(violations.map(v => v.replace(/^#\d+ /, '').split(' :: ')[0]))], violations.slice(0, 5).join('\n')).toEqual([])
  })
})

describe('decideImport invariant sweep', () => {
  it('never edits a published version, never reuses a version number, and plans every locale once', () => {
    const STATUSES = ['draft', 'in_review', 'published', 'superseded', 'archived']
    const LOCALES = ['en', 'es'] as const
    const plan = (locales: readonly ('en' | 'es')[]): StrikePackagePlan => ({
      slug: 'm', title: 'M', description: null, category: null, tags: [], estimatedMinutes: 5, mediaPrefix: 'global/m/v1',
      versions: locales.map(locale => ({
        documentName: 'x', locale, title: locale, content: { blocks: [] }, questions: [], passingScore: 80,
        retakeLimit: null, validityDays: null, downloadPath: null,
      })),
      uploads: [], ignored: [], externalMedia: [],
    })
    const violations: string[] = []
    let executed = 0
    // Existing modules with up to three versions, every status and locale combination.
    const slots = [null, ...STATUSES.flatMap(status => LOCALES.map(locale => ({ status, locale })))]
    for (const a of slots) for (const b of slots) for (const c of slots) {
      const versions = [a, b, c].filter(Boolean).map((v, i) => ({ id: `v${i + 1}`, version_number: i + 1, status: v!.status, locale: v!.locale }))
      const existing: ExistingModule | null = versions.length === 0 && a === null ? null : { id: 'mod', status: 'published', versions }
      for (const locales of [['en'], ['es'], ['en', 'es']] as const) {
        executed++
        const decision = decideImport(plan(locales), existing)
        const label = `${JSON.stringify(versions.map(v => `${v.version_number}:${v.status}:${v.locale}`))} + ${locales.join(',')}`
        if (decision.versions.map(v => v.locale).join() !== locales.join()) violations.push(`locales planned wrong ${label}`)
        const used = new Set(versions.map(v => v.version_number))
        for (const action of decision.versions) {
          if (action.action === 'update') {
            const target = versions.find(v => v.id === action.versionId)
            if (!target || !['draft', 'in_review'].includes(target.status)) violations.push(`edits non-draft ${label}`)
            if (target && target.locale !== action.locale) violations.push(`edits another locale ${label}`)
          }
          if (action.action === 'create') {
            if (used.has(action.versionNumber)) violations.push(`reuses version number ${label}`)
            used.add(action.versionNumber)
          }
          if (action.action === 'refused' && versions.some(v => v.locale === action.locale && ['draft', 'in_review'].includes(v.status))) {
            violations.push(`refuses an editable locale ${label}`)
          }
        }
      }
    }
    expect(executed).toBe(11 ** 3 * 3)
    expect(violations).toEqual([])
  })
})
