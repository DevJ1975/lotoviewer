import { apiBase, authHeaders } from '@/lib/api'
import type { IncidentCreateInput, IncidentRow } from '@soteria/core/incident'

// Incident intake goes through the web API rather than a direct insert: the
// route fires the intake notifications and writes the command-center safety
// alert, neither of which a client-side insert would trigger.
export async function createIncident(tenantId: string, input: IncidentCreateInput): Promise<IncidentRow> {
  const res = await fetch(`${apiBase()}/api/incidents`, {
    method:  'POST',
    headers: await authHeaders(tenantId),
    body:    JSON.stringify(input),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
  return body.report as IncidentRow
}
