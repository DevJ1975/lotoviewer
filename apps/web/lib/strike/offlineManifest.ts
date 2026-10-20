import type { SupabaseClient } from '@supabase/supabase-js'
import type { StrikeQuestionType, StrikeQuizAnswerKey } from '@soteria/core/strike'
import { parseStrikeContent, strikeContentAssetPaths } from '@soteria/core/strikeContent'
import { latestVersionPerLocale } from '@soteria/core/strikeLocale'
import { fetchAll, type PageQuery } from '@/lib/strike/fetchAll'
import { deriveOfflineKey, encryptAnswerKey, type EncryptedAnswerKey } from '@/lib/strike/offlineKey'
import type { StrikeDevice } from '@/lib/strike/deviceAuth'

// Everything a tablet needs to run STRIKE with no connection: the modules the
// tenant can see, the quiz questions (without answers), the quiz answer key
// encrypted for this device, and, for a shared tablet, the roster to pick a
// worker from. Media is not in here: the device fetches signed URLs for it
// from the assets route when the worker chooses to download a module.

/** A cap, not a feature: one response must stay a sane size. A tenant past it needs paging. */
const MAX_VERSIONS = 200
const IN_CHUNK = 100
const ROSTER_LIMIT = 5000

export interface OfflineManifestVersion {
  id: string
  locale: string
  version_number: number
  title: string | null
  passing_score: number
  retake_limit: number | null
  validity_days: number | null
  content: unknown
  asset_paths: string[]
  questions: {
    id: string
    question_type: string
    prompt: string
    sort_order: number
    required: boolean
    points: number
    answers: { id: string; answer_text: string; sort_order: number }[]
  }[]
  answer_key: EncryptedAnswerKey
  /** base64 AES-256 key for `answer_key`, bound to this device (or user) and version. */
  answer_key_secret: string
}

export interface OfflineManifestModule {
  id: string
  title: string
  description: string | null
  category: string | null
  estimated_minutes: number | null
  versions: OfflineManifestVersion[]
}

export interface OfflineManifestRosterEntry {
  member_id: string
  name: string
  /** sha256 of the normalized badge / employee id, as member_identifier_hashes stores it. */
  identifiers: { type: string; hash: string }[]
}

export interface OfflineManifest {
  generated_at: string
  tenant_id: string
  device: { id: string; name: string } | null
  modules: OfflineManifestModule[]
  roster: OfflineManifestRosterEntry[] | null
  truncated: boolean
}

export async function buildOfflineManifest(
  admin: SupabaseClient,
  opts: { tenantId: string; device: StrikeDevice | null; keyScope: string; now?: Date },
): Promise<OfflineManifest> {
  const { tenantId } = opts

  const moduleRows = await fetchAll<{ id: string; title: string; description: string | null; category: string | null; estimated_minutes: number | null }>(() =>
    admin
      .from('strike_modules')
      .select('id,title,description,category,estimated_minutes')
      .eq('status', 'published')
      .or(`tenant_id.eq.${tenantId},library_scope.eq.global`)
      .order('id'),
  )

  const versionRows = await fetchInChunks<{
    id: string; module_id: string; locale: string; version_number: number; title: string | null
    passing_score: number; retake_limit: number | null; validity_days: number | null; content: unknown
  }>(moduleRows.map(m => m.id), ids =>
    admin
      .from('strike_module_versions')
      .select('id,module_id,locale,version_number,title,passing_score,retake_limit,validity_days,content')
      .in('module_id', ids)
      .eq('status', 'published')
      .not('content', 'is', null)
      .order('id'),
  )

  // Newest published version per (module, language); older ones are not worth carrying offline.
  const versionsByModule = new Map<string, typeof versionRows>()
  for (const v of versionRows) versionsByModule.set(v.module_id, [...(versionsByModule.get(v.module_id) ?? []), v])
  const chosen = moduleRows.flatMap(m => [...latestVersionPerLocale(versionsByModule.get(m.id) ?? []).values()])
  const truncated = chosen.length > MAX_VERSIONS
  const versions = chosen.slice(0, MAX_VERSIONS)

  const versionIds = versions.map(v => v.id)
  const questions = await fetchInChunks<{
    id: string; module_version_id: string; question_type: string; prompt: string; sort_order: number
    required: boolean; points: number; explanation: string | null
  }>(versionIds, ids =>
    admin
      .from('strike_quiz_questions')
      .select('id,module_version_id,question_type,prompt,sort_order,required,points,explanation')
      .in('module_version_id', ids)
      .eq('graded', true)
      .order('id'),
  )
  const answers = await fetchInChunks<{ id: string; question_id: string; answer_text: string; sort_order: number; is_correct: boolean }>(
    questions.map(q => q.id),
    ids => admin.from('strike_quiz_answers').select('id,question_id,answer_text,sort_order,is_correct').in('question_id', ids).order('id'),
  )

  const answersByQuestion = new Map<string, typeof answers>()
  for (const a of answers) answersByQuestion.set(a.question_id, [...(answersByQuestion.get(a.question_id) ?? []), a])
  const questionsByVersion = new Map<string, typeof questions>()
  for (const q of questions) questionsByVersion.set(q.module_version_id, [...(questionsByVersion.get(q.module_version_id) ?? []), q])

  const modules: OfflineManifestModule[] = []
  for (const moduleRow of moduleRows) {
    const manifestVersions: OfflineManifestVersion[] = []
    for (const version of versions.filter(v => v.module_id === moduleRow.id)) {
      const parsed = parseStrikeContent(version.content)
      // Unparseable content cannot be played, so it cannot be taken offline either.
      if (!parsed.ok) continue
      const versionQuestions = (questionsByVersion.get(version.id) ?? []).sort(bySortOrder)

      const key = deriveOfflineKey(opts.keyScope, version.id)
      const answerKey: StrikeQuizAnswerKey[] = versionQuestions.map(q => ({
        questionId: q.id,
        questionType: q.question_type as StrikeQuestionType,
        required: q.required,
        points: q.points,
        correctAnswerIds: (answersByQuestion.get(q.id) ?? []).filter(a => a.is_correct).map(a => a.id),
      }))
      const explanations: Record<string, string> = {}
      for (const q of versionQuestions) if (q.explanation?.trim()) explanations[q.id] = q.explanation.trim()

      manifestVersions.push({
        id: version.id,
        locale: version.locale,
        version_number: version.version_number,
        title: version.title,
        passing_score: version.passing_score,
        retake_limit: version.retake_limit,
        validity_days: version.validity_days,
        content: version.content,
        asset_paths: strikeContentAssetPaths(parsed.content),
        questions: versionQuestions.map(q => ({
          id: q.id,
          question_type: q.question_type,
          prompt: q.prompt,
          sort_order: q.sort_order,
          required: q.required,
          points: q.points,
          // answer_text only: is_correct travels solely inside the encrypted key.
          answers: (answersByQuestion.get(q.id) ?? []).sort(bySortOrder).map(a => ({ id: a.id, answer_text: a.answer_text, sort_order: a.sort_order })),
        })),
        answer_key: encryptAnswerKey(key, { questions: answerKey, explanations }),
        answer_key_secret: key.toString('base64'),
      })
    }
    if (manifestVersions.length === 0) continue
    modules.push({
      id: moduleRow.id,
      title: moduleRow.title,
      description: moduleRow.description,
      category: moduleRow.category,
      estimated_minutes: moduleRow.estimated_minutes,
      versions: manifestVersions,
    })
  }

  return {
    generated_at: (opts.now ?? new Date()).toISOString(),
    tenant_id: tenantId,
    device: opts.device ? { id: opts.device.id, name: opts.device.name } : null,
    modules,
    roster: opts.device ? await loadRoster(admin, tenantId, opts.device) : null,
    truncated,
  }
}

async function loadRoster(admin: SupabaseClient, tenantId: string, device: StrikeDevice): Promise<OfflineManifestRosterEntry[]> {
  let query = admin
    .from('members')
    .select('id,display_name,preferred_name')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('display_name')
    .limit(ROSTER_LIMIT)
  if (device.department) query = query.eq('department', device.department)
  if (device.siteLabel) query = query.eq('site_label', device.siteLabel)
  const { data: members, error } = await query
  if (error) throw new Error(error.message)
  const rows = (members ?? []) as { id: string; display_name: string; preferred_name: string | null }[]

  const identifiers = await fetchInChunks<{ member_id: string; identifier_type: string; search_key_hash: string }>(
    rows.map(m => m.id),
    ids => admin
      .from('member_identifier_hashes')
      .select('member_id,identifier_type,search_key_hash')
      .eq('tenant_id', tenantId)
      .in('identifier_type', ['badge_id', 'employee_id'])
      .in('member_id', ids)
      .order('search_key_hash'),
  )
  const byMember = new Map<string, { type: string; hash: string }[]>()
  for (const row of identifiers) {
    byMember.set(row.member_id, [...(byMember.get(row.member_id) ?? []), { type: row.identifier_type, hash: row.search_key_hash }])
  }
  return rows.map(m => ({ member_id: m.id, name: m.preferred_name || m.display_name, identifiers: byMember.get(m.id) ?? [] }))
}

/** A long `.in()` list overflows the request URL, so ask for it in slices. */
async function fetchInChunks<T>(
  ids: string[],
  build: (chunk: string[]) => PageQuery,
): Promise<T[]> {
  const rows: T[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    rows.push(...await fetchAll<T>(() => build(ids.slice(i, i + IN_CHUNK))))
  }
  return rows
}

function bySortOrder(a: { sort_order: number }, b: { sort_order: number }): number {
  return a.sort_order - b.sort_order
}
