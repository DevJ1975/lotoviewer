import { supabase } from '@/lib/supabase'
import { FLEET_BUCKET } from '@soteria/core/fleetStorage'
import type { VehicleInput, PlacardRow, DocumentRow } from '@soteria/core/fleet'
import type { DriverInput, DriverRow } from '@soteria/core/fleetDriver'

// Browser client for the /api/fleet/* family. Mirrors lib/members/client.ts:
// a bearer token from the supabase session + the x-active-tenant header on
// every call, and a thin readJson that surfaces the API's error message.

async function authHeader(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
}

async function headers(tenantId: string, json = false): Promise<Record<string, string>> {
  return {
    ...(json ? { 'content-type': 'application/json' } : {}),
    'x-active-tenant': tenantId,
    ...(await authHeader()),
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`)
  return json as T
}

// ── Vehicles ───────────────────────────────────────────────────────────────
export interface VehicleListRow {
  id: string; unit_number: string | null; make: string | null; model: string | null
  model_year: number | null; vin: string | null; license_plate: string | null
  vehicle_type: string; status: string; photo_path: string | null
  carries_hazmat: boolean; assigned_driver_id: string | null
  usdot_number: string | null; annual_dot_inspection_at: string | null
}

export async function listVehicles(tenantId: string, opts: { status?: string; hazmat?: boolean } = {}): Promise<VehicleListRow[]> {
  const u = new URL('/api/fleet/vehicles', window.location.origin)
  if (opts.status) u.searchParams.set('status', opts.status)
  if (opts.hazmat) u.searchParams.set('hazmat', 'true')
  const res = await fetch(u.pathname + u.search, { headers: await headers(tenantId) })
  return (await readJson<{ vehicles: VehicleListRow[] }>(res)).vehicles
}

export async function getVehicle(tenantId: string, id: string) {
  const res = await fetch(`/api/fleet/vehicles/${id}`, { headers: await headers(tenantId) })
  return readJson<{ vehicle: Record<string, unknown>; placards: PlacardRow[]; documents: DocumentRow[]; chemicals: VehicleChemicalRow[] }>(res)
}

export async function createVehicle(tenantId: string, input: VehicleInput) {
  const res = await fetch('/api/fleet/vehicles', { method: 'POST', headers: await headers(tenantId, true), body: JSON.stringify(input) })
  return (await readJson<{ vehicle: { id: string } }>(res)).vehicle
}

export async function updateVehicle(tenantId: string, id: string, input: VehicleInput) {
  const res = await fetch(`/api/fleet/vehicles/${id}`, { method: 'PATCH', headers: await headers(tenantId, true), body: JSON.stringify(input) })
  return (await readJson<{ vehicle: Record<string, unknown> }>(res)).vehicle
}

export async function deleteVehicle(tenantId: string, id: string): Promise<void> {
  const res = await fetch(`/api/fleet/vehicles/${id}`, { method: 'DELETE', headers: await headers(tenantId) })
  await readJson(res)
}

export async function putPlacards(tenantId: string, vehicleId: string, placards: Partial<PlacardRow>[]) {
  const res = await fetch(`/api/fleet/vehicles/${vehicleId}/placards`, { method: 'PUT', headers: await headers(tenantId, true), body: JSON.stringify({ placards }) })
  return (await readJson<{ placards: PlacardRow[] }>(res)).placards
}

export interface VehicleChemicalRow {
  id: string; vehicle_id: string; chemical_product_id: string
  max_quantity: number | null; quantity_unit: string | null; un_number: string | null; notes: string | null
  chemical_products?: { id: string; name: string; manufacturer: string | null; dot_un_number: string | null; dot_hazard_class: string | null; active_sds_id: string | null } | null
}

export async function putChemicals(tenantId: string, vehicleId: string, chemicals: Array<{ chemical_product_id: string; max_quantity?: number | null; quantity_unit?: string | null; un_number?: string | null; notes?: string | null }>) {
  const res = await fetch(`/api/fleet/vehicles/${vehicleId}/chemicals`, { method: 'PUT', headers: await headers(tenantId, true), body: JSON.stringify({ chemicals }) })
  return (await readJson<{ chemicals: VehicleChemicalRow[] }>(res)).chemicals
}

export async function addDocument(tenantId: string, vehicleId: string, doc: Partial<DocumentRow>) {
  const res = await fetch(`/api/fleet/vehicles/${vehicleId}/documents`, { method: 'POST', headers: await headers(tenantId, true), body: JSON.stringify(doc) })
  return (await readJson<{ document: DocumentRow }>(res)).document
}

export async function deleteDocument(tenantId: string, docId: string): Promise<string | null> {
  const res = await fetch(`/api/fleet/documents/${docId}`, { method: 'DELETE', headers: await headers(tenantId) })
  return (await readJson<{ file_path: string | null }>(res)).file_path
}

// ── Drivers ──────────────────────────────────────────────────────────────
export type DriverWithWorker = DriverRow & { loto_workers?: { id: string; full_name: string; employee_id: string | null } | null }

export async function listDrivers(tenantId: string, opts: { status?: string } = {}): Promise<DriverWithWorker[]> {
  const u = new URL('/api/fleet/drivers', window.location.origin)
  if (opts.status) u.searchParams.set('status', opts.status)
  const res = await fetch(u.pathname + u.search, { headers: await headers(tenantId) })
  return (await readJson<{ drivers: DriverWithWorker[] }>(res)).drivers
}

export async function getDriver(tenantId: string, id: string) {
  const res = await fetch(`/api/fleet/drivers/${id}`, { headers: await headers(tenantId) })
  return readJson<{ driver: DriverWithWorker; vehicles: Array<{ id: string; unit_number: string | null; make: string | null; model: string | null; status: string }> }>(res)
}

export async function createDriver(tenantId: string, input: DriverInput) {
  const res = await fetch('/api/fleet/drivers', { method: 'POST', headers: await headers(tenantId, true), body: JSON.stringify(input) })
  return (await readJson<{ driver: DriverWithWorker }>(res)).driver
}

export async function updateDriver(tenantId: string, id: string, input: DriverInput) {
  const res = await fetch(`/api/fleet/drivers/${id}`, { method: 'PATCH', headers: await headers(tenantId, true), body: JSON.stringify(input) })
  return (await readJson<{ driver: DriverWithWorker }>(res)).driver
}

export async function deleteDriver(tenantId: string, id: string): Promise<void> {
  const res = await fetch(`/api/fleet/drivers/${id}`, { method: 'DELETE', headers: await headers(tenantId) })
  await readJson(res)
}

// ── Picker queries (read directly via RLS-scoped supabase client) ───────────
export interface WorkerOption { id: string; full_name: string; employee_id: string | null }

export async function searchWorkers(tenantId: string, q: string): Promise<WorkerOption[]> {
  let query = supabase
    .from('loto_workers')
    .select('id, full_name, employee_id')
    .eq('tenant_id', tenantId)
    .eq('active', true)
    .order('full_name')
    .limit(20)
  if (q.trim()) query = query.ilike('full_name', `%${q.trim()}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as WorkerOption[]
}

export interface ChemicalOption { id: string; name: string; manufacturer: string | null; dot_un_number: string | null; dot_hazard_class: string | null }

export async function searchChemicalProducts(tenantId: string, q: string): Promise<ChemicalOption[]> {
  let query = supabase
    .from('chemical_products')
    .select('id, name, manufacturer, dot_un_number, dot_hazard_class')
    .eq('tenant_id', tenantId)
    .is('archived_at', null)
    .order('name')
    .limit(20)
  if (q.trim()) query = query.ilike('name', `%${q.trim()}%`)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as ChemicalOption[]
}

// ── Storage (private fleet-docs bucket) ────────────────────────────────────
export async function uploadFleetFile(path: string, file: File): Promise<void> {
  const { error } = await supabase.storage.from(FLEET_BUCKET).upload(path, file, { upsert: true, contentType: file.type || undefined })
  if (error) throw new Error(error.message)
}

export async function fleetSignedUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(FLEET_BUCKET).createSignedUrl(path, expiresIn)
  if (error) return null
  return data?.signedUrl ?? null
}

export async function removeFleetFile(path: string): Promise<void> {
  await supabase.storage.from(FLEET_BUCKET).remove([path])
}
