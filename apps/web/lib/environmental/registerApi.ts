import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { FieldError } from '@soteria/core/hazardousWaste'
import { DEFAULT_REVIEW_CADENCE_DAYS, nextReviewDue, type Discipline } from '@soteria/core/managementSystem'
import { requireTenantModuleAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// What every /api/environmental register route shares: reading the body,
// answering with field errors, and the "mark reviewed" action that every
// register row supports. Validation rules themselves live in packages/core.

export const ENVIRONMENTAL_MODULE = 'environmental'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type JsonObject = Record<string, unknown>

export interface RouteContext { params: Promise<{ id: string }> }

/** The request body when it is a JSON object, else null. */
export async function readJsonObject(req: Request): Promise<JsonObject | null> {
  try {
    const body: unknown = await req.json()
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as JsonObject : null
  } catch {
    return null
  }
}

export function invalidJson(): NextResponse {
  return NextResponse.json({ error: 'Body must be a JSON object' }, { status: 400 })
}

export function gateFailure(gate: { status: number; message: string }): NextResponse {
  return NextResponse.json({ error: gate.message }, { status: gate.status })
}

export function notFound(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

function toSnakeCase(field: string): string {
  return field.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

/**
 * 400 with every problem at once. Core validators name fields in camelCase;
 * request bodies use the column names, so the names are converted back.
 */
export function invalidInput(errors: readonly FieldError[]): NextResponse {
  const fieldErrors = errors.map(e => ({ field: toSnakeCase(e.field), message: e.message }))
  return NextResponse.json({
    error: fieldErrors.map(e => `${e.field} ${e.message}`).join('; '),
    fieldErrors,
  }, { status: 400 })
}

/** A body field as trimmed text; '' when absent or not a string, so "is required" reports it. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** An optional body field as trimmed text; null when absent, blank, or not a string. */
export function optionalText(value: unknown): string | null {
  const trimmed = text(value)
  return trimmed.length > 0 ? trimmed : null
}

/** Today's ISO calendar date in UTC, the date every cron and review stamp in the app uses. */
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

/** The columns that record a review of a register row, and when the next one falls due. */
export function reviewStamp(userId: string, now: Date = new Date()) {
  return {
    last_reviewed_at: now.toISOString(),
    reviewed_by:      userId,
    next_review_due:  nextReviewDue(todayUtc(now), DEFAULT_REVIEW_CADENCE_DAYS),
  }
}

/** The register tables whose rows carry review dates. */
export type ReviewableRegister =
  | 'ms_context_issues'
  | 'ms_interested_parties'
  | 'environmental_aspects'
  | 'compliance_calendar_obligations'

/**
 * POST /api/environmental/<register>/[id]/review for one register: an admin
 * confirms the row is still accurate, which pushes its next review a year out.
 * Written through the caller's RLS-scoped client so the audit trigger records who.
 */
export function reviewRouteFor(table: ReviewableRegister) {
  return async function POST(req: Request, ctx: RouteContext): Promise<NextResponse> {
    const { id } = await ctx.params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const gate = await requireTenantModuleAdmin(req, ENVIRONMENTAL_MODULE)
    if (!gate.ok) return gateFailure(gate)

    const { data, error } = await gate.authedClient
      .from(table)
      .update(reviewStamp(gate.userId))
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .select('*')
      .maybeSingle()
    if (error) return sanitizeError(error, `environmental/${table}/review/POST`)
    if (!data) return notFound()
    return NextResponse.json({ row: data })
  }
}

/** The versioned documents: a new version is a new row, and rows are never edited. */
export type VersionedDocument = 'ms_scope_statements' | 'ms_policies'

/**
 * The version number the next save of a document takes. Two admins saving
 * at once both read the same number; the unique (tenant_id, discipline,
 * version) key then refuses the second, which answers versionConflict().
 */
export async function nextVersion(
  client: SupabaseClient,
  table: VersionedDocument,
  tenantId: string,
  discipline: Discipline,
): Promise<{ version: number; error: null } | { version: null; error: unknown }> {
  const { data, error } = await client
    .from(table)
    .select('version')
    .eq('tenant_id', tenantId)
    .eq('discipline', discipline)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return { version: null, error }
  return { version: ((data as { version: number } | null)?.version ?? 0) + 1, error: null }
}

export function versionConflict(): NextResponse {
  return NextResponse.json(
    { error: 'Someone saved another version at the same time. Reload and try again.' },
    { status: 409 },
  )
}
