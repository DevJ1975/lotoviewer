// A STRIKE package is a seed folder (or a zip of one) as the Media Studio
// produces it: `module.json` for the default language, `module.<locale>.json`
// for each translation, the images, narration and captions those documents
// reference, and the rendered `module.mp4` / `module.<locale>.mp4` downloads.
//
// This file turns such a package into an import plan without touching the
// network, so the browser can preview it and list what it must upload, and
// the API route can validate the same documents again before writing rows.
// The path rules mirror services/learning-studio/studio/content.py; keep the
// two in step.
import { parseStrikeContent, type StrikeBlock, type StrikeContent } from '@soteria/core/strikeContent'
import { STRIKE_QUESTION_TYPES, type StrikeQuestionType } from '@soteria/core/strike'

export const STRIKE_PACKAGE_LOCALES = ['en', 'es'] as const
export type StrikePackageLocale = typeof STRIKE_PACKAGE_LOCALES[number]

const DEFAULT_LOCALE: StrikePackageLocale = 'en'
const MODULE_DOCUMENT_RE = /^module(?:\.([a-z]{2}))?\.json$/
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/
const MEDIA_PREFIX_RE = /^global\/[a-z0-9][a-z0-9-]*\/v\d+$/
const MAX_QUESTIONS = 50

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.vtt': 'text/vtt',
  '.mp4': 'video/mp4',
}

export interface StrikePackageDocument {
  /** Basename inside the package, e.g. `module.json` or `module.es.json`. */
  name: string
  json: unknown
}

export interface StrikePackageFile {
  /** Basename inside the package. */
  name: string
  size: number
}

export interface StrikePackageInput {
  documents: StrikePackageDocument[]
  files: StrikePackageFile[]
}

export interface StrikePackageAnswer {
  text: string
  correct: boolean
}

export interface StrikePackageQuestion {
  question_type: StrikeQuestionType
  prompt: string
  explanation: string | null
  answers: StrikePackageAnswer[]
}

export interface StrikePackageVersionPlan {
  documentName: string
  locale: StrikePackageLocale
  title: string
  /** Blocks with bucket paths and every AI approval cleared. */
  content: StrikeContent
  questions: StrikePackageQuestion[]
  passingScore: number
  retakeLimit: number | null
  validityDays: number | null
  /** Bucket path of the rendered MP4 learners may download, when the package has one. */
  downloadPath: string | null
}

export interface StrikePackageUpload {
  name: string
  bucketPath: string
  contentType: string
  size: number
}

export interface StrikePackagePlan {
  slug: string
  title: string
  description: string | null
  category: string | null
  tags: string[]
  estimatedMinutes: number
  mediaPrefix: string
  versions: StrikePackageVersionPlan[]
  uploads: StrikePackageUpload[]
  /** Package files no document references; they stay on disk. */
  ignored: string[]
  /** Bucket paths the content points at outside the package; they must already be in the bucket. */
  externalMedia: string[]
}

export type StrikePackageReadResult =
  | { ok: true; plan: StrikePackagePlan }
  | { ok: false; issues: string[] }

const MAX_DOCUMENTS = STRIKE_PACKAGE_LOCALES.length
const MAX_FILES = 500
const FILE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/**
 * The wire form the browser sends: the parsed module documents plus the name
 * and size of every other file in the package. Returns null for anything
 * that is not that shape, so routes can answer 400 without guessing.
 */
export function parseStrikePackageInput(value: unknown): StrikePackageInput | null {
  if (!isRecord(value) || !Array.isArray(value.documents) || !Array.isArray(value.files)) return null
  if (value.documents.length === 0 || value.documents.length > MAX_DOCUMENTS || value.files.length > MAX_FILES) return null
  const documents: StrikePackageDocument[] = []
  for (const entry of value.documents) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !isStrikePackageDocument(entry.name) || !isRecord(entry.json)) return null
    documents.push({ name: entry.name, json: entry.json })
  }
  const files: StrikePackageFile[] = []
  for (const entry of value.files) {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !FILE_NAME_RE.test(entry.name)) return null
    const size = num(entry.size)
    if (size === null || size < 0) return null
    files.push({ name: entry.name, size })
  }
  return { documents, files }
}

/** Which package files are module documents. Anything else is media or notes. */
export function isStrikePackageDocument(name: string): boolean {
  return MODULE_DOCUMENT_RE.test(name)
}

export function readStrikePackage(input: StrikePackageInput): StrikePackageReadResult {
  const issues: string[] = []
  const documents = [...input.documents].sort((a, b) => a.name.localeCompare(b.name))
  if (documents.length === 0) {
    return { ok: false, issues: ['The package has no module.json.'] }
  }

  const filesByName = new Map(input.files.map(file => [file.name, file]))
  const uploads = new Map<string, StrikePackageUpload>()
  const referenced = new Set<string>()
  const externalMedia = new Set<string>()
  const versions: StrikePackageVersionPlan[] = []
  const headers = new Map<StrikePackageLocale, ModuleHeader>()

  for (const document of documents) {
    const parsed = parseDocument(document, issues)
    if (!parsed) continue
    const first = headers.values().next().value
    if (first && (parsed.header.slug !== first.slug || parsed.header.mediaPrefix !== first.mediaPrefix)) {
      issues.push(`${document.name}: slug and media_prefix must match the other documents (${first.slug}, ${first.mediaPrefix}).`)
      continue
    }
    if (headers.has(parsed.locale)) {
      issues.push(`${document.name}: a second document for locale "${parsed.locale}".`)
      continue
    }
    headers.set(parsed.locale, parsed.header)

    const prefix = parsed.header.mediaPrefix
    const content = rewriteMediaPaths(parsed.content, prefix, document.name, filesByName, uploads, referenced, externalMedia, issues)

    const videoName = downloadVideoName(parsed.locale)
    const video = filesByName.get(videoName)
    if (video) {
      referenced.add(videoName)
      uploads.set(videoName, upload(videoName, `${prefix}/${videoName}`, video.size))
    }

    versions.push({
      documentName: document.name,
      locale: parsed.locale,
      title: parsed.header.title,
      content,
      questions: parsed.questions,
      passingScore: parsed.passingScore,
      retakeLimit: parsed.retakeLimit,
      validityDays: parsed.validityDays,
      downloadPath: video ? `${prefix}/${videoName}` : null,
    })
  }

  if (issues.length > 0) return { ok: false, issues }

  // The module row (title, description, tags) is described in the default
  // language; a translation only adds a version with its own title.
  const header = headers.get(DEFAULT_LOCALE) ?? headers.values().next().value
  if (!header) return { ok: false, issues: ['The package has no readable module document.'] }
  return {
    ok: true,
    plan: {
      slug: header.slug,
      title: header.title,
      description: header.description,
      category: header.category,
      tags: header.tags,
      estimatedMinutes: header.estimatedMinutes,
      mediaPrefix: header.mediaPrefix,
      versions: versions.sort((a, b) => (a.locale === DEFAULT_LOCALE ? -1 : b.locale === DEFAULT_LOCALE ? 1 : a.locale.localeCompare(b.locale))),
      uploads: [...uploads.values()].sort((a, b) => a.name.localeCompare(b.name)),
      ignored: input.files.map(f => f.name).filter(name => !referenced.has(name) && !isStrikePackageDocument(name)).sort(),
      externalMedia: [...externalMedia].sort(),
    },
  }
}

export function downloadVideoName(locale: StrikePackageLocale): string {
  return locale === DEFAULT_LOCALE ? 'module.mp4' : `module.${locale}.mp4`
}

export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  const extension = dot === -1 ? '' : path.slice(dot).toLowerCase()
  return CONTENT_TYPES[extension] ?? 'application/octet-stream'
}

// ── Documents ───────────────────────────────────────────────────────────────

interface ModuleHeader {
  slug: string
  title: string
  description: string | null
  category: string | null
  tags: string[]
  estimatedMinutes: number
  mediaPrefix: string
}

interface ParsedDocument {
  header: ModuleHeader
  locale: StrikePackageLocale
  content: StrikeContent
  questions: StrikePackageQuestion[]
  passingScore: number
  retakeLimit: number | null
  validityDays: number | null
}

function parseDocument(document: StrikePackageDocument, issues: string[]): ParsedDocument | null {
  const label = document.name
  const fail = (message: string): null => {
    issues.push(`${label}: ${message}`)
    return null
  }
  const match = MODULE_DOCUMENT_RE.exec(document.name)
  if (!match) return fail('not a module document.')
  const raw = document.json
  if (!isRecord(raw)) return fail('must be a JSON object.')

  const localeFromName = match[1] ?? DEFAULT_LOCALE
  const locale = str(raw.locale) || DEFAULT_LOCALE
  if (!isOneOf(locale, STRIKE_PACKAGE_LOCALES)) return fail(`locale "${locale}" is not supported (${STRIKE_PACKAGE_LOCALES.join(', ')}).`)
  if (locale !== localeFromName) return fail(`locale "${locale}" does not match the file name (expected ${localeFromName}).`)
  if (raw.library_scope !== undefined && raw.library_scope !== 'global') {
    return fail('only global library packages can be imported here.')
  }

  const header = parseHeader(raw, issues, label)
  if (!header) return null

  const parsedContent = parseStrikeContent(raw.content)
  if (!parsedContent.ok) {
    for (const issue of parsedContent.issues) issues.push(`${label}: block ${issue.index + 1}: ${issue.message}`)
    return null
  }

  const questions = parseQuestions(raw.questions, issues, label)
  if (!questions) return null

  const passingScore = num(raw.passing_score) ?? 80
  if (passingScore < 1 || passingScore > 100) return fail('passing_score must be between 1 and 100.')
  const retakeLimit = optionalPositiveInt(raw.retake_limit)
  if (retakeLimit === undefined) return fail('retake_limit must be null or a positive whole number.')
  const validityDays = optionalPositiveInt(raw.validity_days)
  if (validityDays === undefined) return fail('validity_days must be null or a positive whole number.')

  return { header, locale, content: parsedContent.content, questions, passingScore, retakeLimit, validityDays }
}

function parseHeader(raw: Record<string, unknown>, issues: string[], label = 'module.json'): ModuleHeader | null {
  const fail = (message: string): null => {
    issues.push(`${label}: ${message}`)
    return null
  }
  const slug = str(raw.slug)
  if (!SLUG_RE.test(slug)) return fail('slug must be 2–80 lowercase letters, digits or dashes.')
  // strike_modules.title is capped at 160 by the database (114); versions
  // allow 200 (301) but the module row is what a package creates first.
  const title = str(raw.title)
  if (!title || title.length > 160) return fail('title is required (160 characters max).')
  const mediaPrefix = str(raw.media_prefix).replace(/^\/+|\/+$/g, '')
  if (!MEDIA_PREFIX_RE.test(mediaPrefix)) return fail('media_prefix must look like global/<slug>/v1.')
  const estimatedMinutes = num(raw.estimated_minutes)
  if (estimatedMinutes === null || estimatedMinutes < 1 || estimatedMinutes > 60) return fail('estimated_minutes must be between 1 and 60.')
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(Boolean) : []
  return {
    slug,
    title,
    description: str(raw.description) || null,
    category: str(raw.category) || null,
    tags: tags.slice(0, 12),
    estimatedMinutes: Math.round(estimatedMinutes),
    mediaPrefix,
  }
}

function parseQuestions(raw: unknown, issues: string[], label: string): StrikePackageQuestion[] | null {
  if (!Array.isArray(raw) || raw.length === 0) {
    issues.push(`${label}: questions must be a non-empty array.`)
    return null
  }
  if (raw.length > MAX_QUESTIONS) {
    issues.push(`${label}: at most ${MAX_QUESTIONS} questions.`)
    return null
  }
  const questions: StrikePackageQuestion[] = []
  raw.forEach((entry, index) => {
    const fail = (message: string) => issues.push(`${label}: question ${index + 1}: ${message}`)
    if (!isRecord(entry)) return fail('must be an object.')
    const questionType = str(entry.question_type)
    if (!isOneOf(questionType, STRIKE_QUESTION_TYPES)) return fail(`unknown question_type "${questionType}".`)
    const prompt = str(entry.prompt)
    if (!prompt || prompt.length > 2000) return fail('prompt is required (2000 characters max).')
    const answers = Array.isArray(entry.answers)
      ? entry.answers.map(a => (isRecord(a) && str(a.text) ? { text: str(a.text), correct: a.correct === true } : null))
      : []
    if (answers.length < 1 || answers.some(a => a === null)) return fail('every answer needs text.')
    if (answers.some(a => a!.text.length > 1000)) return fail('answers are capped at 1000 characters.')
    const valid = answers as StrikePackageAnswer[]
    const correct = valid.filter(a => a.correct).length
    if (questionType === 'true_false' && valid.length !== 2) return fail('true/false needs exactly two answers.')
    if ((questionType === 'multiple_choice' || questionType === 'true_false') && correct !== 1) return fail('needs exactly one correct answer.')
    if (questionType === 'select_all' && correct < 1) return fail('select-all needs at least one correct answer.')
    if (questionType !== 'acknowledgement' && valid.length < 2) return fail('needs at least two answers.')
    questions.push({ question_type: questionType, prompt, explanation: str(entry.explanation) || null, answers: valid })
  })
  return questions.length === raw.length ? questions : null
}

// ── Media ───────────────────────────────────────────────────────────────────

/**
 * Bare file names become bucket paths under the module's media prefix and are
 * queued for upload; paths that already carry a folder are left alone (they
 * are expected to be in the bucket already, as content.py allows). Every AI
 * approval is cleared: a package made by a tool never carries a human's sign-off.
 */
function rewriteMediaPaths(
  content: StrikeContent,
  prefix: string,
  label: string,
  filesByName: Map<string, StrikePackageFile>,
  uploads: Map<string, StrikePackageUpload>,
  referenced: Set<string>,
  externalMedia: Set<string>,
  issues: string[],
): StrikeContent {
  const resolve = (original: string): string => {
    if (original.includes('/')) {
      // A global module may only point at global media; a tenant's folder
      // would be served to every learner through the service-role signer.
      // A dot segment ("global/../<tenant>/…") would escape that check.
      const segments = original.split('/')
      if (segments[0] !== 'global' || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        issues.push(`${label}: media path "${original}" must be a plain path under global/.`)
      } else {
        externalMedia.add(original)
      }
      return original
    }
    const file = filesByName.get(original)
    if (!file) {
      issues.push(`${label}: media file "${original}" is not in the package.`)
      return original
    }
    const bucketPath = `${prefix}/${original}`
    referenced.add(original)
    uploads.set(original, upload(original, bucketPath, file.size))
    return bucketPath
  }

  const blocks = content.blocks.map((block): StrikeBlock => {
    switch (block.kind) {
      case 'motion_scene':
        return {
          ...block,
          image: block.image ? { ...block.image, path: resolve(block.image.path), ...clearedApproval(block.image.ai_generated) } : null,
          narration: block.narration
            ? {
                ...block.narration,
                audio_path: resolve(block.narration.audio_path),
                captions_path: resolve(block.narration.captions_path),
                ...clearedApproval(block.narration.ai_generated),
              }
            : null,
        }
      case 'hotspot':
        return { ...block, image: { ...block.image, path: resolve(block.image.path), ...clearedApproval(block.image.ai_generated) } }
      case 'scenario':
        return { ...block, image: block.image ? { ...block.image, path: resolve(block.image.path), ...clearedApproval(block.image.ai_generated) } : null }
      default:
        return block
    }
  })
  return { blocks }
}

function clearedApproval(aiGenerated: boolean) {
  return { ai_generated: aiGenerated, approved_by: null, approved_at: null }
}

function upload(name: string, bucketPath: string, size: number): StrikePackageUpload {
  return { name, bucketPath, contentType: contentTypeFor(name), size }
}

// ── Small parsers ───────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** null/undefined → null, a positive whole number → itself, anything else → undefined (invalid). */
function optionalPositiveInt(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}
