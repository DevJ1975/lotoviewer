import type { FieldError } from '@soteria/core/hazardousWaste'
import type { ManifestAction } from '@soteria/core/hazardousWasteManifest'
import type { ManifestDetail, ManifestListItem, ShippableContainer } from '@/lib/hazardousWasteManifestView'
import { readActiveFacility, supabase } from '@/lib/supabase'

// The browser's side of /api/hazardous-waste/manifests: the bearer token, the active account
// and, because a manifest belongs to a site, the active site. A failed call throws a
// ManifestApiError carrying the message the route chose to give, and the field errors a form
// can mark.

export class ManifestApiError extends Error {
  constructor(message: string, readonly status: number, readonly fieldErrors: FieldError[] = []) {
    super(message)
  }
}

async function call<T>(tenantId: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession()
  const facilityId = readActiveFacility()
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: {
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      'x-active-tenant': tenantId,
      ...(facilityId ? { 'x-active-facility': facilityId } : {}),
      ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const json = await res.json().catch(() => ({})) as { error?: string; fieldErrors?: FieldError[] }
  if (!res.ok) throw new ManifestApiError(json.error ?? `HTTP ${res.status}`, res.status, json.fieldErrors ?? [])
  return json as T
}

const BASE = '/api/hazardous-waste/manifests'

export interface ManifestListFilters {
  /** One status, or none for every manifest but the cancelled. */
  status?: string
  offset?: number
}

export function listManifests(tenantId: string, filters: ManifestListFilters = {}) {
  const params = new URLSearchParams()
  if (filters.status) params.set('status', filters.status)
  if (filters.offset) params.set('offset', String(filters.offset))
  const query = params.toString()
  return call<{ manifests: ManifestListItem[]; total: number; nextOffset: number | null }>(tenantId, query ? `${BASE}?${query}` : BASE)
}

export const getManifest = (tenantId: string, id: string) =>
  call<{ manifest: ManifestDetail }>(tenantId, `${BASE}/${id}`)

export const createManifest = (tenantId: string, body: Record<string, unknown>) =>
  call<{ manifest: ManifestDetail }>(tenantId, BASE, { method: 'POST', body })

export const updateManifest = (tenantId: string, id: string, body: Record<string, unknown>) =>
  call<{ manifest: ManifestDetail }>(tenantId, `${BASE}/${id}`, { method: 'PATCH', body })

export const transitionManifest = (tenantId: string, id: string, body: { action: ManifestAction; on: string | null; note: string | null }) =>
  call<{ manifest: ManifestDetail }>(tenantId, `${BASE}/${id}/transition`, { method: 'POST', body })

export const listShippableContainers = (tenantId: string) =>
  call<{ containers: ShippableContainer[]; total: number }>(tenantId, `${BASE}/shippable-containers`)
