'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft, Loader2, Plus, Search, ShieldCheck, ShieldAlert, ShieldX,
  Users, Pencil, Archive, ArchiveRestore, Save, X as XIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { evaluateLotoTraining, type LotoTrainingStatus } from '@/lib/trainingRecords'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { LotoWorker, TrainingRecord } from '@soteria/core/types'

// CRUD page for the loto_workers table. Lets a tenant admin manage
// the shop-floor roster: add, rename, change employee_id, deactivate
// (soft-delete by flipping `active`), and reactivate. Each row also
// shows the worker's current LOTO training status so the admin can
// spot expiries before they block checkouts.
//
// Architecturally this is a thin admin tool over the table — direct
// supabase reads/writes via RLS (admin write policy from migration
// 051). No server-side route needed; tenant_id is set by the column
// default (migration 052) on inserts.

type StatusFilter = 'active' | 'inactive' | 'all'

interface WorkerRow extends LotoWorker {
  // Decorated with the most-recent training status for display.
  trainingStatus: LotoTrainingStatus
}

export default function WorkersPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [workers, setWorkers] = useState<LotoWorker[] | null>(null)
  const [trainingByName, setTrainingByName] = useState<Map<string, TrainingRecord[]>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)

  const [filter, setFilter] = useState<StatusFilter>('active')
  const [search, setSearch] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [busyId,  setBusyId]  = useState<string | null>(null)
  const [editId,  setEditId]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    const { data, error } = await supabase
      .from('loto_workers')
      .select('*')
      .order('full_name', { ascending: true })
    if (error) {
      setLoadError(error.message)
      setWorkers([])
      return
    }
    setWorkers((data ?? []) as LotoWorker[])

    // Pull training records (just authorized_employee role — that's
    // the LOTO-relevant cert. RLS lets any tenant member read.)
    const { data: trainings } = await supabase
      .from('loto_training_records')
      .select('*')
      .eq('role', 'authorized_employee')
    const map = new Map<string, TrainingRecord[]>()
    for (const t of (trainings ?? []) as TrainingRecord[]) {
      const k = t.worker_name.trim().toLowerCase()
      const list = map.get(k) ?? []
      list.push(t)
      map.set(k, list)
    }
    setTrainingByName(map)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    void load()
  }, [authLoading, profile, load])

  const decorated: WorkerRow[] = useMemo(() => {
    if (!workers) return []
    const now = new Date()
    return workers.map(w => ({
      ...w,
      trainingStatus: evaluateLotoTraining({
        workerName: w.full_name,
        records:    trainingByName.get(w.full_name.trim().toLowerCase()) ?? [],
        asOf:       now,
      }),
    }))
  }, [workers, trainingByName])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return decorated.filter(w => {
      if (filter === 'active'   && !w.active) return false
      if (filter === 'inactive' &&  w.active) return false
      if (!q) return true
      return (
        w.full_name.toLowerCase().includes(q) ||
        (w.employee_id ?? '').toLowerCase().includes(q) ||
        (w.email       ?? '').toLowerCase().includes(q)
      )
    })
  }, [decorated, filter, search])

  async function setActive(w: LotoWorker, next: boolean) {
    setBusyId(w.id)
    const { error } = await supabase
      .from('loto_workers')
      .update({ active: next })
      .eq('id', w.id)
    setBusyId(null)
    if (error) {
      setLoadError(formatSupabaseError(error, next ? 'reactivate worker' : 'deactivate worker'))
      return
    }
    await load()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const activeCount   = decorated.filter(w => w.active).length
  const inactiveCount = decorated.length - activeCount
  const trainingGapsCount = decorated.filter(w => w.active && (w.trainingStatus.status === 'missing' || w.trainingStatus.status === 'expired')).length

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Users className="h-6 w-6 text-brand-navy" />
          Workers
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Shop-floor roster eligible to be issued LOTO devices. Workers tracked here don&apos;t need an app login — names + optional employee IDs are enough for OSHA recordkeeping.
        </p>
      </div>

      {/* Tiles */}
      <div className="grid grid-cols-3 gap-3">
        <Tile label="Active"          value={activeCount}        />
        <Tile label="Inactive"        value={inactiveCount}      />
        <Tile label="Training gaps"   value={trainingGapsCount}  tone={trainingGapsCount > 0 ? 'warn' : 'normal'} />
      </div>

      {/* Filter pills + add button + search */}
      <section className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden text-xs font-semibold">
          {(['active', 'inactive', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? 'px-3 py-1.5 bg-brand-navy text-white'
                  : 'px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }
            >
              {f === 'active' ? 'Active' : f === 'inactive' ? 'Inactive' : 'All'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-1 sm:flex-none sm:min-w-[260px]">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <input
              type="text"
              placeholder="Search name, employee ID, email"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-7 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </div>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90 transition-colors inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            New worker
          </button>
        </div>
      </section>

      {loadError && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-3 py-2">
          {loadError}
        </p>
      )}

      {/* Add form */}
      {addOpen && (
        <AddWorkerForm
          tenantId={tenantId}
          createdBy={profile?.id ?? null}
          onCancel={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); void load() }}
        />
      )}

      {/* Worker table */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {workers === null
          ? <div className="p-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
          : filtered.length === 0
            ? <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                {filter === 'active' ? 'No active workers — use New worker above to add one.'
                : filter === 'inactive' ? 'No inactive workers.'
                : 'No workers yet.'}
              </p>
            : (
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="text-left px-3 py-2">Worker</th>
                    <th className="text-left px-3 py-2">Employee ID</th>
                    <th className="text-left px-3 py-2">Training</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filtered.map(w => (
                    <WorkerRowView
                      key={w.id}
                      worker={w}
                      busy={busyId === w.id}
                      editing={editId === w.id}
                      onEdit={() => setEditId(w.id)}
                      onCancelEdit={() => setEditId(null)}
                      onSaved={() => { setEditId(null); void load() }}
                      onDeactivate={() => setActive(w, false)}
                      onReactivate={() => setActive(w, true)}
                    />
                  ))}
                </tbody>
              </table>
            )}
      </section>
    </div>
  )
}

// ── Tile ────────────────────────────────────────────────────────────────
function Tile({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'warn' }) {
  const cls = tone === 'warn'
    ? 'border-amber-200 dark:border-amber-700/50 bg-amber-50/40 dark:bg-amber-900/10'
    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
  return (
    <div className={`p-3 rounded-lg border ${cls}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-0.5 text-2xl font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
    </div>
  )
}

// ── Add form ────────────────────────────────────────────────────────────
function AddWorkerForm({
  tenantId, createdBy, onCancel, onSaved,
}: {
  tenantId:  string | null
  createdBy: string | null
  onCancel:  () => void
  onSaved:   () => void
}) {
  const [fullName,    setFullName]    = useState('')
  const [employeeId,  setEmployeeId]  = useState('')
  const [email,       setEmail]       = useState('')
  const [completedAt, setCompletedAt] = useState('')
  const [expiresAt,   setExpiresAt]   = useState('')
  const [authority,   setAuthority]   = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState<string | null>(null)

  async function submit() {
    if (busy) return
    if (!fullName.trim()) { setError('Full name is required.'); return }
    setBusy(true); setError(null)

    const wInsert: Record<string, unknown> = {
      full_name:   fullName.trim(),
      employee_id: employeeId.trim() || null,
      email:       email.trim() || null,
      created_by:  createdBy,
    }
    // tenant_id default fires from x-active-tenant; explicit set is
    // harmless belt-and-suspenders if useTenant has resolved.
    if (tenantId) wInsert.tenant_id = tenantId

    const { data: created, error: wErr } = await supabase
      .from('loto_workers')
      .insert(wInsert)
      .select('id')
      .single()
    if (wErr || !created) {
      setBusy(false)
      if (wErr?.message?.includes('idx_loto_workers_employee_id')) {
        setError(`A worker with employee ID "${employeeId.trim()}" already exists.`)
      } else {
        setError(formatSupabaseError(wErr, 'add worker'))
      }
      return
    }

    if (completedAt) {
      // Best-effort training record. Same case-insensitive name match
      // pattern as the checkout dialog.
      const { error: trainErr } = await supabase
        .from('loto_training_records')
        .insert({
          worker_name:    fullName.trim(),
          role:           'authorized_employee',
          completed_at:   completedAt,
          expires_at:     expiresAt || null,
          cert_authority: authority.trim() || null,
          notes:          'Added via /admin/workers',
        })
      if (trainErr) {
        setError(`Worker added, but training record failed: ${trainErr.message}. Add it under Admin → Training records.`)
        setBusy(false)
        // Don't return — onSaved() refreshes the list, the worker DOES exist.
      }
    }

    setBusy(false)
    onSaved()
  }

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">New worker</h2>
        <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 disabled:opacity-40">
          <XIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FieldText label="Full name *"  value={fullName}   onChange={setFullName}   placeholder="Maria Santos"      disabled={busy} />
        <FieldText label="Employee ID"  value={employeeId} onChange={setEmployeeId} placeholder="EMP-1234 (optional)" disabled={busy} mono />
        <FieldText label="Email"        value={email}      onChange={setEmail}      placeholder="optional"           disabled={busy} type="email" />
      </div>

      <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-2">
          LOTO training (29 CFR 1910.147) — optional, can add later
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FieldDate label="Completed on" value={completedAt} onChange={setCompletedAt} disabled={busy} />
          <FieldDate label="Expires"      value={expiresAt}   onChange={setExpiresAt}   disabled={busy} />
          <FieldText label="Issued by"    value={authority}   onChange={setAuthority}   placeholder="Plant Safety, ABC Inc." disabled={busy} />
        </div>
      </div>

      {error && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-2 py-1.5">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="px-4 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
        <button type="button" onClick={submit} disabled={busy} className="px-4 py-1.5 rounded-md bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 inline-flex items-center gap-1.5">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          {busy ? 'Saving…' : 'Add worker'}
        </button>
      </div>
    </section>
  )
}

function FieldText({ label, value, onChange, placeholder, disabled, mono, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean; mono?: boolean; type?: string
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50 ${mono ? 'font-mono' : ''}`}
      />
    </label>
  )
}

function FieldDate({ label, value, onChange, disabled }: {
  label: string; value: string; onChange: (v: string) => void; disabled?: boolean
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</span>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy disabled:opacity-50"
      />
    </label>
  )
}

// ── Worker row (view + inline edit) ─────────────────────────────────────
function WorkerRowView({
  worker, busy, editing, onEdit, onCancelEdit, onSaved, onDeactivate, onReactivate,
}: {
  worker:        WorkerRow
  busy:          boolean
  editing:       boolean
  onEdit:        () => void
  onCancelEdit:  () => void
  onSaved:       () => void
  onDeactivate:  () => void
  onReactivate:  () => void
}) {
  const [name,       setName]       = useState(worker.full_name)
  const [employeeId, setEmployeeId] = useState(worker.employee_id ?? '')
  const [email,      setEmail]      = useState(worker.email ?? '')
  const [savingEdit, setSavingEdit] = useState(false)
  const [editError,  setEditError]  = useState<string | null>(null)

  // Reset local state when the underlying worker changes (e.g. after
  // a refresh) or when the edit mode is cancelled.
  useEffect(() => {
    setName(worker.full_name)
    setEmployeeId(worker.employee_id ?? '')
    setEmail(worker.email ?? '')
    setEditError(null)
  }, [worker.id, worker.full_name, worker.employee_id, worker.email, editing])

  async function saveEdit() {
    if (savingEdit) return
    if (!name.trim()) { setEditError('Full name is required.'); return }
    setSavingEdit(true); setEditError(null)
    const { error } = await supabase
      .from('loto_workers')
      .update({
        full_name:   name.trim(),
        employee_id: employeeId.trim() || null,
        email:       email.trim() || null,
      })
      .eq('id', worker.id)
    setSavingEdit(false)
    if (error) {
      if (error.message.includes('idx_loto_workers_employee_id')) {
        setEditError(`A worker with employee ID "${employeeId.trim()}" already exists.`)
      } else {
        setEditError(formatSupabaseError(error, 'update worker'))
      }
      return
    }
    onSaved()
  }

  if (editing) {
    return (
      <tr className="bg-slate-50 dark:bg-slate-900/40">
        <td className="px-3 py-2" colSpan={5}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2">
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Full name *" disabled={savingEdit} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm" />
            <input type="text" value={employeeId} onChange={e => setEmployeeId(e.target.value)} placeholder="Employee ID" disabled={savingEdit} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm font-mono" />
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" disabled={savingEdit} className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-sm" />
          </div>
          {editError && <p className="text-[11px] text-rose-700 dark:text-rose-300 mb-2">{editError}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancelEdit} disabled={savingEdit} className="px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">Cancel</button>
            <button type="button" onClick={saveEdit} disabled={savingEdit} className="px-3 py-1 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90 inline-flex items-center gap-1">
              {savingEdit ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td className="px-3 py-2 text-slate-900 dark:text-slate-100 font-medium">
        {worker.full_name}
        {worker.email && (
          <span className="block text-[10px] text-slate-500 dark:text-slate-400">{worker.email}</span>
        )}
      </td>
      <td className="px-3 py-2 font-mono text-slate-600 dark:text-slate-300">
        {worker.employee_id ?? <span className="text-slate-400 dark:text-slate-500 italic">—</span>}
      </td>
      <td className="px-3 py-2"><TrainingPill status={worker.trainingStatus} /></td>
      <td className="px-3 py-2">
        {worker.active
          ? <span className="text-[10px] font-bold uppercase tracking-wide bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 px-1.5 py-0.5 rounded">active</span>
          : <span className="text-[10px] font-bold uppercase tracking-wide bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-1.5 py-0.5 rounded">inactive</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="inline-flex gap-1">
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            title="Edit"
            aria-label="Edit"
            className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          {worker.active ? (
            <button
              type="button"
              onClick={onDeactivate}
              disabled={busy}
              title="Deactivate"
              aria-label="Deactivate"
              className="p-1.5 rounded-md text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Archive className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <button
              type="button"
              onClick={onReactivate}
              disabled={busy}
              title="Reactivate"
              aria-label="Reactivate"
              className="p-1.5 rounded-md text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArchiveRestore className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

function TrainingPill({ status }: { status: LotoTrainingStatus }) {
  if (status.status === 'current') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-800 dark:text-emerald-200 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded font-medium">
        <ShieldCheck className="h-3 w-3" />
        current
      </span>
    )
  }
  if (status.status === 'expiring') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-amber-900 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded font-medium" title={`expires ${status.expires_on}`}>
        <ShieldAlert className="h-3 w-3" />
        expires in {status.days_remaining}d
      </span>
    )
  }
  if (status.status === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-rose-900 dark:text-rose-200 bg-rose-100 dark:bg-rose-950/40 px-1.5 py-0.5 rounded font-medium" title={`expired ${status.expires_on}`}>
        <ShieldX className="h-3 w-3" />
        expired
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-rose-900 dark:text-rose-200 bg-rose-100 dark:bg-rose-950/40 px-1.5 py-0.5 rounded font-medium">
      <ShieldX className="h-3 w-3" />
      no record
    </span>
  )
}
