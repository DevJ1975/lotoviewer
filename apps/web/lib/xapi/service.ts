import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { postStatement } from './client'
import type { XapiEndpoint, XapiPostResult, XapiStatement } from './types'

// High-level façade: load the tenant's LRS configuration, post the
// Statement, and persist exactly one audit row reflecting the
// outcome. Returns the audit row id so the API layer can include it
// in the response for observability.
//
// Side effects are isolated here so the pure builders in
// statements.ts stay unit-testable without mocking Supabase.

export type EmitOutcome =
  | { ok: true;  statementId: string; auditId: string; status: 'sent' | 'skipped' }
  | { ok: false; statementId: string; auditId: string | null; status: 'failed' | 'skipped'
      error: string }

export async function loadEndpoint(tenantId: string): Promise<XapiEndpoint | null> {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('loto_xapi_endpoints')
    .select('id, tenant_id, endpoint_url, auth_key, auth_secret, version, active')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return {
    id:          data.id,
    tenantId:    data.tenant_id,
    endpointUrl: data.endpoint_url,
    authKey:     data.auth_key,
    authSecret:  data.auth_secret,
    version:     data.version,
    active:      data.active,
  }
}

interface EmitArgs {
  tenantId:  string
  statement: XapiStatement
  // Optional override so unit tests can inject a stub LRS and a
  // synthetic endpoint without touching Supabase.
  endpoint?: XapiEndpoint | null
  poster?:   typeof postStatement
}

export async function emit(args: EmitArgs): Promise<EmitOutcome> {
  const endpoint = args.endpoint ?? await loadEndpoint(args.tenantId)
  const admin = supabaseAdmin()
  const base = {
    tenant_id:    args.tenantId,
    statement_id: args.statement.id,
    actor_email:  extractEmail(args.statement),
    verb_id:      args.statement.verb.id,
    object_id:    args.statement.object.id,
    statement:    args.statement,
  }

  if (!endpoint) {
    // No configured LRS for this tenant — record the intent so we
    // can backfill later, but mark it skipped so it doesn't show up
    // in failure dashboards.
    const { data, error } = await admin
      .from('loto_xapi_statements')
      .insert({ ...base, status: 'skipped', completed_at: new Date().toISOString() })
      .select('id')
      .single()
    if (error) {
      return { ok: false, statementId: args.statement.id, auditId: null,
               status: 'skipped', error: error.message }
    }
    return { ok: true, statementId: args.statement.id, auditId: data.id, status: 'skipped' }
  }

  const result: XapiPostResult = await (args.poster ?? postStatement)(endpoint, args.statement)

  const row = {
    ...base,
    endpoint_id:     endpoint.id,
    status:          result.ok ? 'sent' : 'failed',
    response_status: result.status || null,
    response_body:   result.body || null,
    error:           result.ok ? null : result.error,
    completed_at:    new Date().toISOString(),
  }
  const { data, error } = await admin
    .from('loto_xapi_statements')
    .insert(row)
    .select('id')
    .single()

  if (error) {
    return {
      ok:          false,
      statementId: args.statement.id,
      auditId:     null,
      status:      'failed',
      error:       `audit write failed: ${error.message}`,
    }
  }

  if (result.ok) {
    return { ok: true, statementId: args.statement.id, auditId: data.id, status: 'sent' }
  }
  return {
    ok:          false,
    statementId: args.statement.id,
    auditId:     data.id,
    status:      'failed',
    error:       result.error,
  }
}

function extractEmail(s: XapiStatement): string | null {
  const mbox = s.actor.mbox
  if (!mbox?.startsWith('mailto:')) return null
  return mbox.slice('mailto:'.length)
}
