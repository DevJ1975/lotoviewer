import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { STRIKE_QUESTION_TYPES, type StrikeQuestionType } from '@soteria/core/strike'

// Shared validation helpers for STRIKE quiz write routes. Kept private to
// the /quiz subtree (_lib prefix avoids Next.js route detection).

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type LibraryScope = 'global' | 'tenant'

export interface VersionScope {
  versionId: string
  moduleId: string
  tenantId: string | null
  libraryScope: LibraryScope
}

export async function loadVersionForModule(
  admin: ReturnType<typeof supabaseAdmin>,
  moduleId: string,
  versionId: string,
): Promise<VersionScope | { error: string; status: number }> {
  const { data, error } = await admin
    .from('strike_module_versions')
    .select('id, module_id, tenant_id, library_scope, status')
    .eq('id', versionId)
    .eq('module_id', moduleId)
    .maybeSingle()
  if (error) return { error: error.message, status: 500 }
  if (!data) return { error: 'Version not found for module', status: 404 }
  return {
    versionId: data.id as string,
    moduleId: data.module_id as string,
    tenantId: (data.tenant_id as string | null) ?? null,
    libraryScope: data.library_scope as LibraryScope,
  }
}

export async function loadQuestionForModule(
  admin: ReturnType<typeof supabaseAdmin>,
  moduleId: string,
  questionId: string,
): Promise<VersionScope & { questionId: string } | { error: string; status: number }> {
  const { data, error } = await admin
    .from('strike_quiz_questions')
    .select('id, module_version_id, tenant_id, library_scope, strike_module_versions:module_version_id(module_id)')
    .eq('id', questionId)
    .maybeSingle()
  if (error) return { error: error.message, status: 500 }
  if (!data) return { error: 'Question not found', status: 404 }
  const parent = (data.strike_module_versions as { module_id: string } | { module_id: string }[] | null)
  const parentModuleId = Array.isArray(parent) ? parent[0]?.module_id : parent?.module_id
  if (parentModuleId !== moduleId) return { error: 'Question does not belong to module', status: 404 }
  return {
    questionId: data.id as string,
    versionId: data.module_version_id as string,
    moduleId,
    tenantId: (data.tenant_id as string | null) ?? null,
    libraryScope: data.library_scope as LibraryScope,
  }
}

export async function loadAnswerForModule(
  admin: ReturnType<typeof supabaseAdmin>,
  moduleId: string,
  answerId: string,
): Promise<VersionScope & { questionId: string; answerId: string } | { error: string; status: number }> {
  const { data, error } = await admin
    .from('strike_quiz_answers')
    .select(`
      id,
      question_id,
      tenant_id,
      library_scope,
      strike_quiz_questions:question_id(
        id,
        module_version_id,
        strike_module_versions:module_version_id(module_id)
      )
    `)
    .eq('id', answerId)
    .maybeSingle()
  if (error) return { error: error.message, status: 500 }
  if (!data) return { error: 'Answer not found', status: 404 }
  const question = (data.strike_quiz_questions as
    | { id: string; module_version_id: string; strike_module_versions: { module_id: string } | { module_id: string }[] | null }
    | { id: string; module_version_id: string; strike_module_versions: { module_id: string } | { module_id: string }[] | null }[]
    | null
  )
  const q = Array.isArray(question) ? question[0] : question
  if (!q) return { error: 'Answer not found', status: 404 }
  const parent = q.strike_module_versions
  const parentModuleId = Array.isArray(parent) ? parent[0]?.module_id : parent?.module_id
  if (parentModuleId !== moduleId) return { error: 'Answer does not belong to module', status: 404 }
  return {
    answerId: data.id as string,
    questionId: q.id,
    versionId: q.module_version_id,
    moduleId,
    tenantId: (data.tenant_id as string | null) ?? null,
    libraryScope: data.library_scope as LibraryScope,
  }
}

export function normalizeQuestionType(value: unknown): StrikeQuestionType | null {
  if (typeof value !== 'string') return null
  return (STRIKE_QUESTION_TYPES as readonly string[]).includes(value)
    ? (value as StrikeQuestionType)
    : null
}

export function normalizePrompt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 2000 ? trimmed : null
}

export function normalizeAnswerText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 1 && trimmed.length <= 1000 ? trimmed : null
}

export function normalizeOptionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export function normalizeNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.round(n))
}

export function normalizeBool(value: unknown): boolean | undefined {
  if (value === true) return true
  if (value === false) return false
  return undefined
}
