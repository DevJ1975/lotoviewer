'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { GraduationCap, Loader2, Plus, Trash2, Users, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  CHEMICAL_TRAINING_ROLES,
  type ChemicalTrainingRole,
  type TrainingCoverageRow,
} from '@soteria/core/chemicals'
import { TRAINING_ROLE_LABELS } from '@soteria/core/trainingRecords'

interface Requirement {
  id:         string
  product_id: string
  role:       string
  notes:      string | null
  created_at: string
}

interface CoverageSummary {
  total_gaps:       number
  affected_workers: number
}

interface Props {
  productId: string
}

const STATUS_CLS: Record<TrainingCoverageRow['status'], string> = {
  covered: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
  expired: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
  missing: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-300',
}

export default function TrainingRequirementsPanel({ productId }: Props) {
  const { tenant } = useTenant()
  const [requirements, setRequirements] = useState<Requirement[] | null>(null)
  const [coverage, setCoverage] = useState<TrainingCoverageRow[]>([])
  const [summary,  setSummary]  = useState<CoverageSummary>({ total_gaps: 0, affected_workers: 0 })
  const [error,    setError]    = useState<string | null>(null)
  const [busy,     setBusy]     = useState(false)

  const [showAdd, setShowAdd] = useState(false)
  const [role,    setRole]    = useState<ChemicalTrainingRole>('hazcom')
  const [notes,   setNotes]   = useState('')

  const [workersRaw, setWorkersRaw] = useState('')

  const buildHeaders = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    return headers
  }, [tenant])

  const workers = useMemo(
    () => workersRaw.split(',').map(w => w.trim()).filter(Boolean),
    [workersRaw],
  )

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const headers = await buildHeaders()
    const params = new URLSearchParams()
    if (workers.length > 0) params.set('workers', workers.join(','))
    const res = await fetch(
      `/api/chemicals/products/${productId}/training-coverage?${params.toString()}`,
      { headers },
    )
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    setRequirements(body.requirements ?? [])
    setCoverage(body.coverage ?? [])
    setSummary(body.summary ?? { total_gaps: 0, affected_workers: 0 })
  }, [tenant, productId, workers, buildHeaders])

  useEffect(() => { void load() }, [load])

  async function add() {
    setBusy(true)
    setError(null)
    try {
      const headers = await buildHeaders()
      const res = await fetch(`/api/chemicals/products/${productId}/training-requirements`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({
          role,
          notes: notes.trim() || undefined,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      setShowAdd(false)
      setRole('hazcom')
      setNotes('')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function remove(reqId: string) {
    if (!confirm('Drop this training requirement?')) return
    setBusy(true)
    try {
      const headers = await buildHeaders()
      const res = await fetch(
        `/api/chemicals/products/${productId}/training-requirements/${reqId}`,
        { method: 'DELETE', headers },
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <GraduationCap className="w-4 h-4" /> Training requirements
        </h2>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-xs text-indigo-600 hover:underline inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> Add requirement
          </button>
        )}
      </div>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      {showAdd && (
        <div className="rounded border border-slate-200 dark:border-slate-800 px-3 py-2 space-y-2 bg-slate-50 dark:bg-slate-900">
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Role</span>
            <select
              value={role}
              onChange={e => setRole(e.target.value as ChemicalTrainingRole)}
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            >
              {CHEMICAL_TRAINING_ROLES.map(r => (
                <option key={r} value={r}>{TRAINING_ROLE_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Notes (optional)</span>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Refresher annually per OSHA 1910.1200(h)(1)"
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </label>
          <div className="flex justify-end gap-1">
            <button
              onClick={() => { setShowAdd(false); setRole('hazcom'); setNotes('') }}
              className="px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700"
            >Cancel</button>
            <button
              onClick={() => void add()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              {busy && <Loader2 className="w-3 h-3 animate-spin" />} Add
            </button>
          </div>
        </div>
      )}

      {requirements === null ? (
        <div className="text-xs text-slate-500 flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> loading…
        </div>
      ) : requirements.length === 0 ? (
        <div className="text-sm italic text-slate-400">
          No training requirements configured. Add HazCom or chemical-specific roles above.
        </div>
      ) : (
        <ul className="space-y-1">
          {requirements.map(r => (
            <li key={r.id} className="text-sm flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center px-2 py-0.5 text-[11px] font-medium rounded bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                {TRAINING_ROLE_LABELS[r.role as keyof typeof TRAINING_ROLE_LABELS] ?? r.role}
              </span>
              {r.notes && <span className="text-xs text-slate-500 italic">— {r.notes}</span>}
              <button
                onClick={() => void remove(r.id)}
                disabled={busy}
                className="ml-auto text-slate-400 hover:text-rose-600 disabled:opacity-50"
                title="Drop"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {requirements && requirements.length > 0 && (
        <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300 inline-flex items-center gap-1">
              <Users className="w-3 h-3" /> Coverage check (comma-separated worker names)
            </span>
            <input
              type="text"
              value={workersRaw}
              onChange={e => setWorkersRaw(e.target.value)}
              placeholder="Alice, Bob, Charlie"
              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
            />
          </label>

          {workers.length > 0 && (
            summary.total_gaps === 0 ? (
              <div className="rounded border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
                ✓ All {workers.length} worker{workers.length === 1 ? '' : 's'} fully covered.
              </div>
            ) : (
              <div className="rounded border border-rose-300 dark:border-rose-800 bg-rose-50/40 dark:bg-rose-950/20 px-3 py-2 text-xs text-rose-800 dark:text-rose-300 flex items-center gap-1">
                <X className="w-3 h-3" />
                <strong>{summary.total_gaps} gap{summary.total_gaps === 1 ? '' : 's'}</strong>
                {' '}across <strong>{summary.affected_workers}</strong> worker{summary.affected_workers === 1 ? '' : 's'}.
              </div>
            )
          )}

          {coverage.length > 0 && (
            <ul className="text-xs space-y-1">
              {coverage.map((c, i) => (
                <li
                  key={`${c.worker_name}|${c.role}|${i}`}
                  className="flex flex-wrap items-center gap-2"
                >
                  <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${STATUS_CLS[c.status]}`}>
                    {c.status}
                  </span>
                  <span className="font-medium">{c.worker_name}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-700 dark:text-slate-300">
                    {TRAINING_ROLE_LABELS[c.role as keyof typeof TRAINING_ROLE_LABELS] ?? c.role}
                  </span>
                  {c.expires_at && (
                    <span className={`text-[11px] ${c.status === 'expired' ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500'}`}>
                      {c.status === 'expired'
                        ? `expired ${Math.abs(c.days_until_expiry ?? 0)}d ago`
                        : `expires in ${c.days_until_expiry}d`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
