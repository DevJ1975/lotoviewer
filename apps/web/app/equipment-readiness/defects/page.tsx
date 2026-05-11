'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { AlertTriangle, Camera, CheckCircle2, Loader2, Wrench, X } from 'lucide-react'
import { readActiveTenant, supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'

interface DefectRow {
  id: string
  severity: 'monitor' | 'repair_soon' | 'critical'
  status: 'open' | 'acknowledged' | 'in_repair' | 'resolved' | 'cancelled'
  out_of_service: boolean
  description: string
  component: string | null
  last_seen_at: string
  equipment_record_id: string
  equipment?: { equipment_id: string; description: string | null; department: string | null } | null
}

export default function EquipmentDefectsPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const [rows, setRows] = useState<DefectRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [returnDefect, setReturnDefect] = useState<DefectRow | null>(null)
  const [returnNotes, setReturnNotes] = useState('')
  const [repairFiles, setRepairFiles] = useState<File[]>([])

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true)
    setError(null)
    try {
      const { data, error } = await supabase
        .from('equipment_defects')
        .select('id,severity,status,out_of_service,description,component,last_seen_at,equipment_record_id')
        .eq('tenant_id', tenantId)
        .in('status', ['open', 'acknowledged', 'in_repair'])
        .order('last_seen_at', { ascending: false })
      if (error) throw error
      setRows((data ?? []) as DefectRow[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  async function updateDefect(
    id: string,
    action: 'acknowledge' | 'start_repair' | 'return_to_service',
    options: { notes?: string; files?: File[] } = {},
  ) {
    setBusyId(id)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const access = session?.access_token
      const tenantId = readActiveTenant()
      if (!access || !tenantId) throw new Error('Sign in expired or no active tenant.')
      const evidence = action === 'return_to_service'
        ? await uploadRepairEvidence(tenantId, id, options.files ?? [])
        : []
      const res = await fetch(`/api/equipment-readiness/defects/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${access}`,
          'x-active-tenant': tenantId,
        },
        body: JSON.stringify({ action, notes: options.notes ?? '', evidence }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Update failed (${res.status})`)
      setReturnDefect(null)
      setReturnNotes('')
      setRepairFiles([])
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusyId(null)
    }
  }

  function openReturnModal(row: DefectRow) {
    setReturnDefect(row)
    setReturnNotes('')
    setRepairFiles([])
    setError(null)
  }

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">Equipment Defects</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Open findings from pre-use equipment inspections.</p>
        </div>
        <Link href="/equipment-readiness" className="text-sm font-semibold text-teal-700 hover:underline">Back to readiness</Link>
      </header>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}

      <section className="rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        {loading && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {!loading && rows.length === 0 && <p className="p-4 text-sm text-slate-500">No open equipment defects.</p>}
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(row => (
            <article key={row.id} className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    {row.out_of_service && <AlertTriangle className="h-4 w-4 text-rose-600" />}
                    <h2 className="text-sm font-semibold text-slate-950 dark:text-slate-50">{row.description}</h2>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {row.component ?? 'General'} · Last seen {new Date(row.last_seen_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Pill label={row.severity.replace('_', ' ')} tone={row.severity === 'critical' ? 'red' : row.severity === 'repair_soon' ? 'amber' : 'slate'} />
                  <Pill label={row.status.replace('_', ' ')} tone="slate" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {row.status === 'open' && (
                  <ActionButton busy={busyId === row.id} onClick={() => void updateDefect(row.id, 'acknowledge')}>
                    <CheckCircle2 className="h-4 w-4" /> Acknowledge
                  </ActionButton>
                )}
                {(row.status === 'open' || row.status === 'acknowledged') && (
                  <ActionButton busy={busyId === row.id} onClick={() => void updateDefect(row.id, 'start_repair')}>
                    <Wrench className="h-4 w-4" /> Start repair
                  </ActionButton>
                )}
                {(row.status === 'open' || row.status === 'acknowledged' || row.status === 'in_repair') && (
                  <ActionButton busy={busyId === row.id} onClick={() => openReturnModal(row)} primary>
                    <CheckCircle2 className="h-4 w-4" /> Return to service
                  </ActionButton>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      {returnDefect && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 dark:border-slate-800">
              <div>
                <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">Return equipment to service</h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{returnDefect.description}</p>
              </div>
              <button
                type="button"
                onClick={() => setReturnDefect(null)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
                aria-label="Close return-to-service dialog"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Repair summary</span>
                <textarea
                  value={returnNotes}
                  onChange={e => setReturnNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                  placeholder="Describe the repair, verification performed, and why the equipment can be released."
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Repair photos</span>
                <span className="mt-1 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-4 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-900">
                  <Camera className="h-4 w-4" />
                  {repairFiles.length > 0 ? `${repairFiles.length} photo${repairFiles.length === 1 ? '' : 's'} selected` : 'Attach repair or verification photos'}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={e => setRepairFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Return-to-service creates a repair record, stores photos as evidence, and releases the equipment only when no other out-of-service defects remain.
              </p>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setReturnDefect(null)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void updateDefect(returnDefect.id, 'return_to_service', { notes: returnNotes, files: repairFiles })}
                disabled={busyId === returnDefect.id || returnNotes.trim().length < 8}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-60"
              >
                {busyId === returnDefect.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Release equipment
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

async function uploadRepairEvidence(tenantId: string, defectId: string, files: File[]): Promise<Array<{ storage_path: string; caption: string }>> {
  const rows: Array<{ storage_path: string; caption: string }> = []
  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${tenantId}/defects/${defectId}/repairs/${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`
    const { error } = await supabase.storage.from('equipment-evidence').upload(path, file, {
      cacheControl: '3600',
      upsert: false,
    })
    if (error) throw new Error(`Repair photo upload failed: ${error.message}`)
    rows.push({ storage_path: path, caption: 'Return-to-service repair evidence' })
  }
  return rows
}

function ActionButton({ children, busy, primary, onClick }: { children: ReactNode; busy: boolean; primary?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-60 ${
        primary
          ? 'bg-teal-700 text-white hover:bg-teal-800'
          : 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-900'
      }`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : children}
    </button>
  )
}

function Pill({ label, tone }: { label: string; tone: 'red' | 'amber' | 'slate' }) {
  const cls = tone === 'red'
    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
    : tone === 'amber'
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
  return <span className={`rounded-full px-2 py-1 text-[11px] font-semibold capitalize ${cls}`}>{label}</span>
}
