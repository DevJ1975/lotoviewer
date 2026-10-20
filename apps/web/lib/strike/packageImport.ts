// Writes a STRIKE package plan into the global library as drafts. The same
// rows `python manage.py import_seed_module` produces, reached from the web
// app instead of a shell.
//
// Rules carried over from the studio importer:
// - A published version is never touched: one that learners were credited
//   against must not change underneath their completions. Re-importing a
//   locale that is only published is refused, not superseded.
// - A locale that already has a draft or in-review version is updated in
//   place (content, quiz, download), so re-dropping a package after fixes
//   does not pile up versions.
// - A locale the module does not have yet becomes the next version number,
//   which is how translations are stored (strikeLocale.ts).
// - Nothing is written until every media file the content references is in
//   the bucket: the player signs URLs for them and a missing one is a dead
//   scene.
// - No upload may land on a file a published version, or another module,
//   already uses. Uploads overwrite, and media_prefix is whatever the package
//   says, so re-dropping a package with an unchanged prefix (or another
//   module's) would change what learners are shown under a published version.
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseStrikeContent, strikeContentAssetPaths } from '@soteria/core/strikeContent'
import { STRIKE_MEDIA_BUCKET } from '@/lib/strike/assets'
import { fetchAll } from '@/lib/strike/fetchAll'
import type { StrikePackagePlan, StrikePackageVersionPlan } from '@/lib/strike/package'

const EDITABLE_STATUSES = ['draft', 'in_review'] as const
const DEFAULT_LOCALE = 'en'

export interface ExistingVersion {
  id: string
  version_number: number
  status: string
  locale: string
}

export interface ExistingModule {
  id: string
  status: string
  versions: ExistingVersion[]
}

export type VersionAction =
  | { locale: string; action: 'create'; versionNumber: number }
  | { locale: string; action: 'update'; versionId: string; versionNumber: number }
  | { locale: string; action: 'refused'; reason: string }

export interface ImportDecision {
  moduleAction: 'create' | 'update'
  versions: VersionAction[]
  /** Upload paths that would overwrite media in use elsewhere; any one blocks the import. */
  conflicts: string[]
}

/**
 * Pure: what the import would do to this module, locale by locale.
 * `protectedPaths` are bucket paths no upload may replace (see loadProtectedMedia).
 */
export function decideImport(plan: StrikePackagePlan, existing: ExistingModule | null, protectedPaths: ReadonlySet<string> = new Set()): ImportDecision {
  const conflicts = plan.uploads.map(u => u.bucketPath).filter(path => protectedPaths.has(path))
  if (!existing) {
    return {
      moduleAction: 'create',
      versions: plan.versions.map((version, index) => ({ locale: version.locale, action: 'create', versionNumber: index + 1 })),
      conflicts,
    }
  }
  let nextNumber = Math.max(0, ...existing.versions.map(v => v.version_number)) + 1
  const versions = plan.versions.map((version): VersionAction => {
    const inLocale = existing.versions.filter(v => v.locale === version.locale).sort((a, b) => a.version_number - b.version_number)
    const editable = inLocale.filter(v => isEditable(v.status))
    if (editable.length > 0) {
      const target = editable[editable.length - 1]!
      return { locale: version.locale, action: 'update', versionId: target.id, versionNumber: target.version_number }
    }
    if (inLocale.length > 0) {
      const latest = inLocale[inLocale.length - 1]!
      return {
        locale: version.locale,
        action: 'refused',
        reason: `Version ${latest.version_number} (${version.locale}) is ${latest.status} and cannot be overwritten. Start a new version in the studio first.`,
      }
    }
    return { locale: version.locale, action: 'create', versionNumber: nextNumber++ }
  })
  return { moduleAction: 'update', versions, conflicts }
}

export async function loadExistingModule(admin: SupabaseClient, slug: string): Promise<ExistingModule | null> {
  const { data, error } = await admin
    .from('strike_modules')
    .select('id, status, strike_module_versions(id, version_number, status, locale)')
    .eq('slug', slug)
    .eq('library_scope', 'global')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const row = data as { id: string; status: string; strike_module_versions: ExistingVersion[] | null }
  return { id: row.id, status: row.status, versions: row.strike_module_versions ?? [] }
}

/**
 * Media no import may overwrite: everything a published or superseded global
 * version serves (learners were credited against it), and everything any
 * version of a different module uses. This module's own drafts are fair game;
 * replacing their media is what re-dropping a fixed package is for.
 */
export async function loadProtectedMedia(admin: SupabaseClient, moduleId: string | null): Promise<Set<string>> {
  const rows = await fetchAll<{ module_id: string; status: string; content: unknown; download_path: string | null }>(() =>
    admin.from('strike_module_versions')
      .select('id,module_id,status,content,download_path')
      .eq('library_scope', 'global')
      .order('id'))
  const paths = new Set<string>()
  for (const row of rows) {
    if (row.module_id === moduleId && isEditable(row.status)) continue
    const content = parseStrikeContent(row.content)
    if (content.ok) for (const path of strikeContentAssetPaths(content.content)) paths.add(path)
    if (row.download_path) paths.add(row.download_path)
  }
  return paths
}

/**
 * Every bucket path the plan's content needs that is not in strike-media:
 * the files the browser was to upload, and the ones the content points at
 * outside the package (which the import never uploads, so a typo there was
 * a dead scene nobody noticed until a learner reached it).
 */
export async function missingMedia(admin: SupabaseClient, plan: StrikePackagePlan): Promise<string[]> {
  const needed = [...new Set([...plan.uploads.map(u => u.bucketPath), ...plan.externalMedia])]
  const byFolder = new Map<string, string[]>()
  for (const path of needed) {
    const folder = path.slice(0, path.lastIndexOf('/'))
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), path])
  }
  const missing: string[] = []
  for (const [folder, paths] of byFolder) {
    const { data, error } = await admin.storage.from(STRIKE_MEDIA_BUCKET).list(folder, { limit: 1000 })
    if (error) throw new Error(error.message)
    const present = new Set((data ?? []).map(object => `${folder}/${object.name}`))
    missing.push(...paths.filter(path => !present.has(path)))
  }
  return missing.sort()
}

export interface ImportedVersion {
  locale: string
  versionId: string
  versionNumber: number
  action: 'create' | 'update'
}

export interface ImportOutcome {
  moduleId: string
  moduleAction: 'create' | 'update'
  versions: ImportedVersion[]
}

export class ImportRefused extends Error {}

/**
 * Apply a decision. Call only after `missingMedia` came back empty; the
 * quiz is replaced wholesale on an update, the same as the studio importer.
 */
export async function importStrikePackage(
  admin: SupabaseClient,
  plan: StrikePackagePlan,
  existing: ExistingModule | null,
  decision: ImportDecision,
  userId: string,
): Promise<ImportOutcome> {
  if (decision.conflicts.length > 0) {
    throw new ImportRefused(`These files are already used by a published version or another module: ${decision.conflicts.join(', ')}. Give the package a new media_prefix (for example …/v2).`)
  }
  const refused = decision.versions.filter(v => v.action === 'refused')
  if (refused.length > 0) {
    throw new ImportRefused(refused.map(v => (v as { reason: string }).reason).join(' '))
  }

  const moduleFields = {
    title: plan.title,
    description: plan.description,
    category: plan.category,
    tags: plan.tags,
    estimated_minutes: plan.estimatedMinutes,
    updated_by: userId,
  }

  // Without a transaction, order the writes so the status-guarded version
  // updates (the only step that can still be refused) run before anything
  // else changes on an existing module.
  let moduleId: string
  if (existing) {
    moduleId = existing.id
  } else {
    const { data, error } = await admin
      .from('strike_modules')
      .insert({ ...moduleFields, slug: plan.slug, library_scope: 'global', tenant_id: null, status: 'in_review', created_by: userId })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    moduleId = (data as { id: string }).id
  }

  const versions: ImportedVersion[] = []
  const ordered = [...decision.versions].sort((a, b) => Number(b.action === 'update') - Number(a.action === 'update'))
  for (const action of ordered) {
    if (action.action === 'refused') continue
    const version = plan.versions.find(v => v.locale === action.locale)!
    const versionId = action.action === 'update'
      ? await updateVersion(admin, action.versionId, version)
      : await insertVersion(admin, moduleId, action.versionNumber, version, userId)
    await replaceQuiz(admin, versionId, version)
    versions.push({ locale: action.locale, versionId, versionNumber: action.versionNumber, action: action.action })
  }

  if (existing) {
    const changes = ['published', 'archived'].includes(existing.status) ? moduleFields : { ...moduleFields, status: 'in_review' }
    const { error } = await admin.from('strike_modules').update(changes).eq('id', moduleId)
    if (error) throw new Error(error.message)
  }

  return { moduleId, moduleAction: decision.moduleAction, versions }
}

function versionFields(version: StrikePackageVersionPlan) {
  return {
    content: version.content,
    passing_score: version.passingScore,
    retake_limit: version.retakeLimit,
    validity_days: version.validityDays,
    locale: version.locale,
    // The default-language version is described by the module row (301).
    title: version.locale === DEFAULT_LOCALE ? null : version.title,
    download_path: version.downloadPath,
  }
}

async function updateVersion(admin: SupabaseClient, versionId: string, version: StrikePackageVersionPlan): Promise<string> {
  const { data, error } = await admin
    .from('strike_module_versions')
    .update(versionFields(version))
    .eq('id', versionId)
    .in('status', [...EDITABLE_STATUSES])
    .select('id')
  if (error) throw new Error(error.message)
  if (!Array.isArray(data) || data.length !== 1) {
    throw new ImportRefused(`Version for ${version.locale} was published while the import ran; nothing changed for it.`)
  }
  return versionId
}

async function insertVersion(
  admin: SupabaseClient,
  moduleId: string,
  versionNumber: number,
  version: StrikePackageVersionPlan,
  userId: string,
): Promise<string> {
  const { data, error } = await admin
    .from('strike_module_versions')
    .insert({
      ...versionFields(version),
      module_id: moduleId,
      library_scope: 'global',
      tenant_id: null,
      version_number: versionNumber,
      status: 'draft',
      created_by: userId,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

async function replaceQuiz(admin: SupabaseClient, versionId: string, version: StrikePackageVersionPlan): Promise<void> {
  const { error: deleteError } = await admin.from('strike_quiz_questions').delete().eq('module_version_id', versionId)
  if (deleteError) throw new Error(deleteError.message)

  const { data: questions, error: questionError } = await admin
    .from('strike_quiz_questions')
    .insert(version.questions.map((question, index) => ({
      module_version_id: versionId,
      library_scope: 'global',
      tenant_id: null,
      question_type: question.question_type,
      prompt: question.prompt,
      explanation: question.explanation,
      sort_order: index,
      points: 1,
      required: true,
      graded: true,
    })))
    .select('id, sort_order')
  if (questionError) throw new Error(questionError.message)

  const idBySortOrder = new Map((questions as { id: string; sort_order: number }[]).map(q => [q.sort_order, q.id]))
  const answers = version.questions.flatMap((question, index) =>
    question.answers.map((answer, answerIndex) => ({
      question_id: idBySortOrder.get(index),
      library_scope: 'global',
      tenant_id: null,
      answer_text: answer.text,
      is_correct: answer.correct,
      sort_order: answerIndex,
    })),
  )
  const { error: answerError } = await admin.from('strike_quiz_answers').insert(answers)
  if (answerError) throw new Error(answerError.message)
}

function isEditable(status: string): boolean {
  return (EDITABLE_STATUSES as readonly string[]).includes(status)
}
