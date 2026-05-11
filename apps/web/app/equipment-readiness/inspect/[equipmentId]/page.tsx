'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, BookOpen, Camera, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { supabase, readActiveTenant } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import {
  EQUIPMENT_FAMILY_LABEL,
  EQUIPMENT_READINESS_LABEL,
  shouldBlockInspectionForStrike,
  type EquipmentChecklistItem,
  type EquipmentChecklistTemplate,
  type EquipmentFamily,
  type EquipmentReadinessStatus,
  type InspectionEvidenceInput,
  type InspectionResponseValue,
} from '@soteria/core/equipmentReadiness'

interface ResolveResponse {
  equipment: {
    id: string
    equipment_id: string
    description: string | null
    department: string | null
    equipment_family: EquipmentFamily
    readiness_status: EquipmentReadinessStatus | null
  }
  template: EquipmentChecklistTemplate
  items: EquipmentChecklistItem[]
  open_defects: Array<{ id: string; severity: string; status: string; out_of_service: boolean; description: string; last_seen_at: string }>
  latest_inspection: { id: string; submitted_at: string; readiness_result: string } | null
  operator_authorization: { id: string; status: string; evaluation_due_at: string | null; expires_at: string | null } | null
  strike_readiness: {
    status: 'ready' | 'partial' | 'blocked' | 'not_required'
    required_count: number
    valid_completion_count: number
    missing_count: number
    percent: number
    requirements: Array<{ id: string; title: string; slug: string | null; current: boolean; notes: string | null }>
  }
}

interface ResponseState {
  response: InspectionResponseValue | ''
  notes: string
}

type EvidenceKind = InspectionEvidenceInput['evidence_kind']

export default function PreUseInspectionPage() {
  const params = useParams<{ equipmentId: string }>()
  const equipmentId = decodeURIComponent(params.equipmentId)
  const router = useRouter()
  const { profile } = useAuth()
  const [data, setData] = useState<ResolveResponse | null>(null)
  const [responses, setResponses] = useState<Record<string, ResponseState>>({})
  const [hourMeter, setHourMeter] = useState('')
  const [shiftLabel, setShiftLabel] = useState('')
  const [signatureName, setSignatureName] = useState(profile?.full_name ?? '')
  const [attested, setAttested] = useState(false)
  const [files, setFiles] = useState<Record<EvidenceKind, File[]>>({
    equipment_full_view: [],
    hour_meter: [],
    damage: [],
    defect: [],
    repair: [],
    general: [],
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [startedAt] = useState(() => new Date().toISOString())

  const load = useCallback(async () => {
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const access = session?.access_token
    const tenantId = readActiveTenant()
    if (!access || !tenantId) {
      setError('Sign in and select a tenant before inspecting equipment.')
      return
    }
    const res = await fetch(`/api/equipment-readiness/resolve?equipment_id=${encodeURIComponent(equipmentId)}`, {
      headers: { authorization: `Bearer ${access}`, 'x-active-tenant': tenantId },
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(json.error ?? `Resolve failed (${res.status})`)
      return
    }
    const resolved = json as ResolveResponse
    setData(resolved)
    setResponses(Object.fromEntries(resolved.items.map(item => [item.id, { response: '', notes: '' }])))
  }, [equipmentId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (profile?.full_name) setSignatureName(profile.full_name) }, [profile?.full_name])

  const failedCritical = useMemo(() => {
    if (!data) return false
    return data.items.some(item => item.critical && responses[item.id]?.response === 'fail')
  }, [data, responses])
  const strikeBlocked = data ? shouldBlockInspectionForStrike(data.strike_readiness.status) : false

  async function submit() {
    if (!data) return
    setError(null)
    if (files.equipment_full_view.length === 0) {
      setError('Capture a current full-view equipment photo before submitting.')
      return
    }
    if (strikeBlocked) {
      setError('STRIKE refresher training is required before this equipment can be operated.')
      return
    }
    const missing = data.items.filter(item => item.required && !responses[item.id]?.response)
    if (missing.length > 0) {
      setError(`Complete required item: ${missing[0].prompt}`)
      return
    }
    if (!attested) {
      setError('Confirm the operator attestation before submitting.')
      return
    }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const access = session?.access_token
      const tenantId = readActiveTenant()
      if (!access || !tenantId) throw new Error('Sign in expired or no active tenant.')

      const evidence = await uploadEvidence(tenantId, data.equipment.equipment_id, files)
      const responseRows = data.items.map(item => {
        const state = responses[item.id]
        const failed = state.response === 'fail'
        return {
          item_id: item.id,
          response: state.response,
          notes: state.notes,
          numeric_value: item.response_type === 'number' ? Number(hourMeter) || null : null,
          severity: failed ? (item.critical ? 'critical' : 'repair_soon') : null,
          action_decision: failed ? (item.critical ? 'remove_from_service' : 'limited_use') : null,
        }
      })

      const res = await fetch('/api/equipment-readiness/inspections', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${access}`,
          'x-active-tenant': tenantId,
        },
        body: JSON.stringify({
          equipment_id: data.equipment.equipment_id,
          checklist_template_id: data.template.id,
          started_at: startedAt,
          submitted_at: new Date().toISOString(),
          shift_label: shiftLabel,
          hour_meter: hourMeter,
          operator_attestation: attested,
          signature_name: signatureName,
          responses: responseRows,
          evidence,
          client_context: { source: 'equipment-readiness-web' },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Submission failed (${res.status})`)
      router.push('/equipment-readiness')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (!data && !error) {
    return <main className="max-w-3xl mx-auto px-4 py-10 text-sm text-slate-500">Loading inspection…</main>
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <Link href="/equipment-readiness/scan" className="text-sm font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">Back to scanner</Link>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      )}

      {data && (
        <>
          <header className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="font-mono text-xl font-semibold text-slate-950 dark:text-slate-50">{data.equipment.equipment_id}</h1>
                {data.equipment.description && <p className="text-sm text-slate-600 dark:text-slate-300">{data.equipment.description}</p>}
                <p className="mt-1 text-xs text-slate-500">
                  {EQUIPMENT_FAMILY_LABEL[data.equipment.equipment_family]} · {data.equipment.department ?? 'No department'}
                </p>
              </div>
              <StatusPill status={data.equipment.readiness_status ?? 'available'} />
            </div>
            {data.operator_authorization ? (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                <CheckCircle2 className="h-4 w-4" /> Operator authorization found for this equipment family.
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
                <ShieldAlert className="h-4 w-4" /> No active authorization record was found. Continue only if site policy allows supervisor-controlled entry.
              </div>
            )}
            {data.strike_readiness.status !== 'not_required' && (
              <div className={`mt-3 rounded-md border p-3 text-xs ${
                strikeBlocked
                  ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
                  : 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
              }`}>
                <p className="font-semibold">
                  STRIKE readiness: {data.strike_readiness.valid_completion_count}/{data.strike_readiness.required_count} current
                </p>
                {strikeBlocked && <p className="mt-1">Required refresher training is missing or expired. Complete it before operating this equipment.</p>}
                <ul className="mt-2 space-y-1">
                  {data.strike_readiness.requirements.map(req => (
                    <li key={req.id} className="flex items-center justify-between gap-3">
                      <span>{req.title}</span>
                      <span className="font-semibold">{req.current ? 'Current' : 'Needed'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {data.open_defects.length > 0 && (
              <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
                <p className="font-semibold">Open defects on this equipment</p>
                <ul className="mt-1 list-disc pl-5">
                  {data.open_defects.slice(0, 3).map(defect => <li key={defect.id}>{defect.description}</li>)}
                </ul>
              </div>
            )}
            <Link
              href={`/strike?source=equipment-readiness&equipment=${encodeURIComponent(data.equipment.equipment_id)}`}
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-teal-200 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-50 dark:border-teal-900 dark:text-teal-200 dark:hover:bg-teal-950/30"
            >
              <BookOpen className="h-4 w-4" />
              Open STRIKE refreshers for this equipment
            </Link>
          </header>

          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{data.template.title}</h2>
            {data.template.osha_basis && <p className="mt-1 text-xs text-slate-500">{data.template.osha_basis}</p>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Shift
                <input value={shiftLabel} onChange={e => setShiftLabel(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" placeholder="Day, night, line 2…" />
              </label>
              <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                Hour meter / battery reading
                <input value={hourMeter} onChange={e => setHourMeter(e.target.value)} inputMode="decimal" className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
              </label>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Camera className="h-4 w-4" /> Photo evidence
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <FileInput label="Full-view equipment photo" required onChange={next => setFiles(prev => ({ ...prev, equipment_full_view: next }))} />
              <FileInput label="Hour meter / battery" onChange={next => setFiles(prev => ({ ...prev, hour_meter: next }))} />
              <FileInput label="Damage or defect photos" multiple onChange={next => setFiles(prev => ({ ...prev, damage: next }))} />
            </div>
          </section>

          <section className="space-y-3">
            {data.items.map(item => (
              <div key={item.id} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{item.section}</p>
                    <p className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-50">{item.prompt}</p>
                    {item.help_text && <p className="mt-1 text-xs text-slate-500">{item.help_text}</p>}
                  </div>
                  {item.critical && <span className="rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold uppercase text-rose-700 dark:bg-rose-950/50 dark:text-rose-200">Critical</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(['pass', 'fail', 'na'] as const).map(value => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setResponses(prev => ({ ...prev, [item.id]: { ...prev[item.id], response: value } }))}
                      className={`rounded-md border px-3 py-2 text-sm font-medium ${
                        responses[item.id]?.response === value
                          ? value === 'fail'
                            ? 'border-rose-600 bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200'
                            : 'border-teal-700 bg-teal-50 text-teal-800 dark:bg-teal-950/40 dark:text-teal-200'
                          : 'border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900'
                      }`}
                    >
                      {value === 'na' ? 'N/A' : value[0].toUpperCase() + value.slice(1)}
                    </button>
                  ))}
                </div>
                {responses[item.id]?.response === 'fail' && (
                  <textarea
                    value={responses[item.id]?.notes ?? ''}
                    onChange={e => setResponses(prev => ({ ...prev, [item.id]: { ...prev[item.id], notes: e.target.value } }))}
                    className="mt-3 min-h-20 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                    placeholder="Describe damage, defect, location, and immediate action taken."
                  />
                )}
              </div>
            ))}
          </section>

          {failedCritical && (
            <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              A critical item failed. Submitting will mark this equipment out of service pending review.
            </div>
          )}

          <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
              Signature name
              <input value={signatureName} onChange={e => setSignatureName(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <label className="mt-3 flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
              <input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} className="mt-1" />
              I inspected this equipment before use and reported all visible damage or unsafe conditions.
            </label>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60 sm:w-auto"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Submit pre-use inspection
            </button>
          </section>
        </>
      )}
    </main>
  )
}

function FileInput({ label, required, multiple, onChange }: { label: string; required?: boolean; multiple?: boolean; onChange: (files: File[]) => void }) {
  return (
    <label className="rounded-md border border-dashed border-slate-300 p-3 text-xs font-medium text-slate-600 dark:border-slate-700 dark:text-slate-300">
      {label} {required && <span className="text-rose-600">*</span>}
      <input
        type="file"
        accept="image/*"
        capture="environment"
        multiple={multiple}
        onChange={e => onChange(Array.from(e.target.files ?? []))}
        className="mt-2 block w-full text-xs"
      />
    </label>
  )
}

function StatusPill({ status }: { status: EquipmentReadinessStatus }) {
  const cls = status === 'available'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
    : status === 'limited_use'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
  return <span className={`self-start rounded-full px-2 py-1 text-[11px] font-semibold ${cls}`}>{EQUIPMENT_READINESS_LABEL[status]}</span>
}

async function uploadEvidence(
  tenantId: string,
  equipmentId: string,
  files: Record<EvidenceKind, File[]>,
): Promise<InspectionEvidenceInput[]> {
  const rows: InspectionEvidenceInput[] = []
  for (const [kind, fileList] of Object.entries(files) as Array<[EvidenceKind, File[]]>) {
    for (const file of fileList) {
      const safeId = equipmentId.replace(/[^a-z0-9._-]/gi, '_')
      const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
      const path = `${tenantId}/${safeId}/inspections/pending/${Date.now()}-${kind}.${ext}`
      const { error } = await supabase.storage.from('equipment-evidence').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
      })
      if (error) throw new Error(`Photo upload failed: ${error.message}`)
      rows.push({ storage_path: path, evidence_kind: kind, captured_at: new Date().toISOString() })
    }
  }
  return rows
}
