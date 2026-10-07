// Client for the Python service's generic job queue (POST /jobs).
//
// The service (services/sds-parser) owns slow work a serverless route cannot
// wait for: reading a scanned permit, loading regulations, importing history.
// A route records what it needs in its own table, then calls enqueueServiceJob;
// the service's worker does the work and writes the result back.
//
// Same contract as lib/ai/sdsFallback.ts: opt-in via SDS_PARSER_URL, and the
// call NEVER throws. It returns null when the service is not configured, has
// background jobs switched off (503), or fails, so the caller decides what to
// tell its user instead of every route needing its own try/catch.

// Enqueueing is a couple of small database writes on the service; anything
// slower means it is struggling.
const ENQUEUE_TIMEOUT_MS = 10_000

export interface EnqueueServiceJobArgs {
  kind:        string
  tenantId:    string
  payload:     Record<string, unknown>
  requestedBy?: string
  /** At most one live job per (kind, tenant, dedupeKey); a repeat returns the live one. */
  dedupeKey?:  string
}

/** True when the operator has pointed the deployment at the service. */
export function serviceJobsConfigured(): boolean {
  return Boolean(process.env.SDS_PARSER_URL)
}

export async function enqueueServiceJob(args: EnqueueServiceJobArgs): Promise<{ jobId: string } | null> {
  const base = process.env.SDS_PARSER_URL
  if (!base) return null

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const apiKey = process.env.SDS_PARSER_API_KEY
  if (apiKey) headers['x-api-key'] = apiKey

  const body = JSON.stringify({
    kind: args.kind,
    tenant_id: args.tenantId,
    payload: args.payload,
    requested_by: args.requestedBy,
    dedupe_key: args.dedupeKey,
  })

  try {
    const resp = await fetch(`${base.replace(/\/+$/, '')}/jobs`, {
      method: 'POST', body, headers, signal: AbortSignal.timeout(ENQUEUE_TIMEOUT_MS),
    })
    if (resp.status !== 202) return null
    const json = (await resp.json()) as { job_id?: unknown }
    return typeof json.job_id === 'string' ? { jobId: json.job_id } : null
  } catch {
    return null
  }
}
