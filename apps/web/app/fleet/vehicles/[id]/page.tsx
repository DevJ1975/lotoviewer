'use client'

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Truck, Loader2, Pencil, Trash2, Upload, ShieldAlert, FileText, FlaskConical, Siren, X, ClipboardCheck, Check } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import {
  getVehicle, updateVehicle, deleteVehicle, putPlacards, putChemicals,
  addDocument, deleteDocument, uploadFleetFile, fleetSignedUrl, removeFleetFile,
  searchChemicalProducts, listVehicleInspections,
  type VehicleChemicalRow, type ChemicalOption, type InspectionRow,
} from '@/lib/fleet/client'
import { VehicleForm } from '../../_components/VehicleForm'
import {
  HAZARD_CLASSES, HAZARD_CLASS_LABELS, DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS,
  checkHazmatConsistency, type VehicleRow, type PlacardRow, type DocumentRow,
  type HazardClass, type VehicleInput,
} from '@soteria/core/fleet'
import { vehiclePhotoPath, vehicleDocumentPath } from '@soteria/core/fleetStorage'

export default function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { tenant, role } = useTenant()
  const tenantId = tenant?.id
  const isAdmin = role === 'owner' || role === 'admin'

  const [vehicle, setVehicle] = useState<VehicleRow | null>(null)
  const [placards, setPlacards] = useState<PlacardRow[]>([])
  const [documents, setDocuments] = useState<DocumentRow[]>([])
  const [chemicals, setChemicals] = useState<VehicleChemicalRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const data = await getVehicle(tenantId, id)
      setVehicle(data.vehicle as unknown as VehicleRow)
      setPlacards(data.placards)
      setDocuments(data.documents)
      setChemicals(data.chemicals)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [tenantId, id])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!vehicle?.photo_path) { setPhotoUrl(null); return }
    let cancelled = false
    void fleetSignedUrl(vehicle.photo_path).then(u => { if (!cancelled) setPhotoUrl(u) })
    return () => { cancelled = true }
  }, [vehicle?.photo_path])

  async function handleEdit(input: VehicleInput) {
    if (!tenantId) return
    await updateVehicle(tenantId, id, input)
    setEditing(false)
    await load()
  }

  async function handleDelete() {
    if (!tenantId || !confirm('Delete this vehicle and all its placards, documents, and links?')) return
    await deleteVehicle(tenantId, id)
    router.push('/fleet/vehicles')
  }

  async function handlePhoto(file: File) {
    if (!tenantId) return
    const path = vehiclePhotoPath(tenantId, id, file.name)
    await uploadFleetFile(path, file)
    await updateVehicle(tenantId, id, { photo_path: path })
    await load()
  }

  if (loading) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  if (error) return <main className="mx-auto max-w-4xl px-4 py-6"><div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div></main>
  if (!vehicle) return null

  const title = vehicle.unit_number || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle'
  const hazmat = checkHazmatConsistency({ carriesHazmat: vehicle.carries_hazmat, placardCount: placards.length, chemicalCount: chemicals.length })

  if (editing) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-6 space-y-5">
        <PageHeader icon={Truck} title={`Edit ${title}`} back={`/fleet/vehicles/${id}`} />
        <VehicleForm submitLabel="Save changes" onSubmit={handleEdit} initial={toInput(vehicle)} />
        <button onClick={() => setEditing(false)} className="text-sm text-slate-500 hover:underline">Cancel</button>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 space-y-5">
      <PageHeader
        icon={Truck}
        title={title}
        description={[vehicle.model_year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || undefined}
        back="/fleet/vehicles"
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/fleet/vehicles/${id}/inspect`} className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy/90"><ClipboardCheck className="h-4 w-4" /> Inspect</Link>
            {isAdmin && <>
              <Link href={`/incidents/new?source=fleet&vehicle=${id}`} className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300"><Siren className="h-4 w-4" /> Report incident</Link>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300"><Pencil className="h-4 w-4" /> Edit</button>
              <button onClick={handleDelete} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700"><Trash2 className="h-4 w-4" /></button>
            </>}
          </div>
        }
      />

      {hazmat.messages.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          <p className="flex items-center gap-1.5 font-semibold"><ShieldAlert className="h-4 w-4" /> Hazmat check</p>
          <ul className="mt-1 list-disc pl-5">{hazmat.messages.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <PhotoCard photoUrl={photoUrl} canEdit={isAdmin} onUpload={handlePhoto} />
        <div className="lg:col-span-2"><DetailGrid vehicle={vehicle} /></div>
      </div>

      <PlacardManager vehicleId={id} placards={placards} canEdit={isAdmin} onSaved={setPlacards} tenantId={tenantId ?? ''} />
      <ChemicalManager vehicleId={id} chemicals={chemicals} canEdit={isAdmin} onSaved={setChemicals} tenantId={tenantId ?? ''} />
      <DocumentManager vehicleId={id} documents={documents} canEdit={isAdmin} onChange={load} tenantId={tenantId ?? ''} />
      <InspectionHistory vehicleId={id} tenantId={tenantId ?? ''} />
    </main>
  )
}

// ── Inspection history ──────────────────────────────────────────────────────
function InspectionHistory({ vehicleId, tenantId }: { vehicleId: string; tenantId: string }) {
  const [rows, setRows] = useState<InspectionRow[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    void listVehicleInspections(tenantId, vehicleId)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [tenantId, vehicleId])

  return (
    <Card title="Inspection history" icon={ClipboardCheck}>
      {loading ? <p className="text-sm text-slate-500">Loading…</p>
        : rows.length === 0 ? <p className="text-sm text-slate-500">No inspections recorded yet.</p>
        : (
          <ul className="space-y-2">
            {rows.map(r => (
              <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{r.inspection_type.replace(/_/g, '-')} · {new Date(r.performed_at).toLocaleDateString()}</p>
                  <p className="text-xs text-slate-500">{r.fleet_driver_profiles?.loto_workers?.full_name ?? 'Unknown'}{r.defects_noted ? ` · ${r.defects_noted}` : ''}</p>
                </div>
                {r.passed
                  ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><Check className="h-3 w-3" /> Pass</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300"><X className="h-3 w-3" /> Fail</span>}
              </li>
            ))}
          </ul>
        )}
    </Card>
  )
}

function toInput(v: VehicleRow): Partial<VehicleInput> {
  const { id: _id, tenant_id: _t, created_at: _c, updated_at: _u, ...rest } = v
  void _id; void _t; void _c; void _u
  return rest
}

// ── Photo ──────────────────────────────────────────────────────────────────
function PhotoCard({ photoUrl, canEdit, onUpload }: { photoUrl: string | null; canEdit: boolean; onUpload: (f: File) => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800">
        {photoUrl ? <img src={photoUrl} alt="Vehicle" className="h-full w-full object-cover" /> : <Truck className="h-10 w-10 text-slate-300" />}
      </div>
      {canEdit && (
        <>
          <input ref={ref} type="file" accept="image/*" className="hidden" onChange={async e => {
            const f = e.target.files?.[0]; if (!f) return
            setBusy(true); try { await onUpload(f) } finally { setBusy(false) }
          }} />
          <button onClick={() => ref.current?.click()} disabled={busy} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-300">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {photoUrl ? 'Replace photo' : 'Upload photo'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Details ──────────────────────────────────────────────────────────────
function DetailGrid({ vehicle }: { vehicle: VehicleRow }) {
  const rows: [string, string | null][] = [
    ['VIN', vehicle.vin], ['Plate', [vehicle.license_plate, vehicle.license_plate_state].filter(Boolean).join(' ') || null],
    ['Status', vehicle.status.replace(/_/g, ' ')], ['Odometer', vehicle.odometer_miles != null ? `${vehicle.odometer_miles.toLocaleString()} mi` : null],
    ['USDOT #', vehicle.usdot_number], ['MC #', vehicle.mc_number],
    ['GVWR', vehicle.gvwr_lbs != null ? `${vehicle.gvwr_lbs.toLocaleString()} lbs` : null],
    ['DOT class', vehicle.dot_vehicle_class ? `Class ${vehicle.dot_vehicle_class}` : null],
    ['Fuel', vehicle.fuel_type], ['IFTA', vehicle.ifta_registered ? 'Registered' : 'No'],
    ['Annual DOT inspection', vehicle.annual_dot_inspection_at], ['Home location', vehicle.home_location_text],
  ]
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{k}</dt>
            <dd className="text-sm text-slate-800 capitalize dark:text-slate-200">{val || '—'}</dd>
          </div>
        ))}
      </dl>
      {vehicle.notes && <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-slate-800 dark:text-slate-400">{vehicle.notes}</p>}
    </div>
  )
}

// ── Placards ──────────────────────────────────────────────────────────────
function PlacardManager({ vehicleId, placards, canEdit, onSaved, tenantId }: { vehicleId: string; placards: PlacardRow[]; canEdit: boolean; onSaved: (p: PlacardRow[]) => void; tenantId: string }) {
  const [rows, setRows] = useState<Partial<PlacardRow>[]>(placards)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setRows(placards) }, [placards])

  async function save() {
    setSaving(true); setErr(null)
    try { onSaved(await putPlacards(tenantId, vehicleId, rows)) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  return (
    <Card title="Hazmat placards" icon={ShieldAlert}>
      {err && <p className="mb-2 text-sm text-rose-600">{err}</p>}
      {rows.length === 0 && <p className="text-sm text-slate-500">No placards recorded.</p>}
      <div className="space-y-2">
        {rows.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select disabled={!canEdit} value={p.hazard_class ?? '3'} onChange={e => upd(setRows, i, { hazard_class: e.target.value as HazardClass })} className="rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900">
              {HAZARD_CLASSES.map(c => <option key={c} value={c}>Class {c} — {HAZARD_CLASS_LABELS[c]}</option>)}
            </select>
            <input disabled={!canEdit} placeholder="UN1203" value={p.un_number ?? ''} onChange={e => upd(setRows, i, { un_number: e.target.value })} className="w-28 rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
            <input disabled={!canEdit} placeholder="Proper shipping name" value={p.proper_shipping_name ?? ''} onChange={e => upd(setRows, i, { proper_shipping_name: e.target.value })} className="flex-1 rounded-md border border-slate-200 px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-900" />
            {canEdit && <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button>}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center gap-2">
          <button onClick={() => setRows([...rows, { hazard_class: '3' }])} className="rounded-md border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300">Add placard</button>
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save placards</button>
        </div>
      )}
    </Card>
  )
}

// ── Chemicals / SDS ─────────────────────────────────────────────────────────
function ChemicalManager({ vehicleId, chemicals, canEdit, onSaved, tenantId }: { vehicleId: string; chemicals: VehicleChemicalRow[]; canEdit: boolean; onSaved: (c: VehicleChemicalRow[]) => void; tenantId: string }) {
  const [rows, setRows] = useState<VehicleChemicalRow[]>(chemicals)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<ChemicalOption[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { setRows(chemicals) }, [chemicals])

  useEffect(() => {
    if (!canEdit || !q.trim()) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(() => { void searchChemicalProducts(tenantId, q).then(r => { if (!cancelled) setResults(r) }).catch(() => {}) }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, canEdit, tenantId])

  function link(c: ChemicalOption) {
    if (rows.some(r => r.chemical_product_id === c.id)) return
    setRows([...rows, { id: `new-${c.id}`, vehicle_id: vehicleId, chemical_product_id: c.id, max_quantity: null, quantity_unit: null, un_number: c.dot_un_number, notes: null, chemical_products: { id: c.id, name: c.name, manufacturer: c.manufacturer, dot_un_number: c.dot_un_number, dot_hazard_class: c.dot_hazard_class, active_sds_id: null } }])
    setQ(''); setResults([])
  }

  async function save() {
    setSaving(true); setErr(null)
    try { onSaved(await putChemicals(tenantId, vehicleId, rows.map(r => ({ chemical_product_id: r.chemical_product_id, max_quantity: r.max_quantity, quantity_unit: r.quantity_unit, un_number: r.un_number, notes: r.notes })))) }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }

  return (
    <Card title="Chemicals carried (SDS)" icon={FlaskConical}>
      {err && <p className="mb-2 text-sm text-rose-600">{err}</p>}
      {rows.length === 0 && <p className="text-sm text-slate-500">No chemicals linked. Linking pulls the substance + SDS from Chemical Management.</p>}
      <ul className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800 dark:text-slate-200">{r.chemical_products?.name ?? r.chemical_product_id}</p>
              <p className="text-xs text-slate-500">{[r.chemical_products?.manufacturer, r.chemical_products?.dot_un_number, r.chemical_products?.dot_hazard_class && `Class ${r.chemical_products.dot_hazard_class}`].filter(Boolean).join(' · ') || '—'}</p>
            </div>
            <div className="flex items-center gap-2">
              <Link href={`/chemicals`} className="text-xs font-semibold text-brand-navy hover:underline dark:text-sky-300"><FileText className="inline h-3.5 w-3.5" /> SDS</Link>
              {canEdit && <button onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button>}
            </div>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 space-y-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search chemical products to link…" className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
          {results.length > 0 && (
            <ul className="rounded-md border border-slate-200 dark:border-slate-700">
              {results.map(c => <li key={c.id}><button onClick={() => link(c)} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-800">{c.name}{c.manufacturer ? ` — ${c.manufacturer}` : ''}</button></li>)}
            </ul>
          )}
          <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save chemicals</button>
        </div>
      )}
    </Card>
  )
}

// ── Documents ───────────────────────────────────────────────────────────────
function DocumentManager({ vehicleId, documents, canEdit, onChange, tenantId }: { vehicleId: string; documents: DocumentRow[]; canEdit: boolean; onChange: () => Promise<void>; tenantId: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const [docType, setDocType] = useState<string>('insurance')
  const [reference, setReference] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function upload(file: File) {
    setBusy(true); setErr(null)
    try {
      const path = vehicleDocumentPath(tenantId, vehicleId, docType, file.name)
      await uploadFleetFile(path, file)
      await addDocument(tenantId, vehicleId, { doc_type: docType as DocumentRow['doc_type'], reference: reference || null, expires_at: expiresAt || null, file_path: path, file_name: file.name, mime_type: file.type || null })
      setReference(''); setExpiresAt('')
      await onChange()
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  async function open(doc: DocumentRow) {
    if (!doc.file_path) return
    const url = await fleetSignedUrl(doc.file_path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  async function remove(doc: DocumentRow) {
    if (!confirm('Delete this document?')) return
    const path = await deleteDocument(tenantId, doc.id)
    if (path) await removeFleetFile(path)
    await onChange()
  }

  return (
    <Card title="Documents (insurance, registration, DOT)" icon={FileText}>
      {err && <p className="mb-2 text-sm text-rose-600">{err}</p>}
      {documents.length === 0 && <p className="text-sm text-slate-500">No scanned documents yet.</p>}
      <ul className="space-y-2">
        {documents.map(d => (
          <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{DOCUMENT_TYPE_LABELS[d.doc_type] ?? d.doc_type}{d.reference ? ` · ${d.reference}` : ''}</p>
              <p className="text-xs text-slate-500">{d.expires_at ? `Expires ${d.expires_at}` : 'No expiry'}{d.file_name ? ` · ${d.file_name}` : ''}</p>
            </div>
            <div className="flex items-center gap-3">
              {d.file_path && <button onClick={() => open(d)} className="text-xs font-semibold text-brand-navy hover:underline dark:text-sky-300">View</button>}
              {canEdit && <button onClick={() => remove(d)} className="text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></button>}
            </div>
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Type</span>
            <select value={docType} onChange={e => setDocType(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm capitalize dark:border-slate-700 dark:bg-slate-900">
              {DOCUMENT_TYPES.map(t => <option key={t} value={t}>{DOCUMENT_TYPE_LABELS[t]}</option>)}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Reference</span>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Policy / plate #" className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">Expires</span>
            <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="rounded-md border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900" />
          </label>
          <input ref={ref} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
          <button onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1.5 rounded-md bg-brand-navy px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload scan</button>
        </div>
      )}
    </Card>
  )
}

function Card({ title, icon: Icon, children }: { title: string; icon: typeof Truck; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300"><Icon className="h-4 w-4" /> {title}</h2>
      {children}
    </section>
  )
}

function upd<T>(setRows: React.Dispatch<React.SetStateAction<T[]>>, i: number, patch: Partial<T>) {
  setRows(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
}
