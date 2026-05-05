'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, GraduationCap, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { TRAINING_ROLE_LABELS } from '@/lib/trainingRecords'
import type { TrainingRecord, TrainingRole } from '@soteria/core/types'

// Training-records register for §1910.146(g) compliance. Admin-only at
// the route level (RLS in migration 017 also enforces admin on writes).
//
// Today: list / add / delete by-row. Edit is handled by deleting + re-
// adding (rows are usually small + each cert is a discrete event, so
// the in-place edit form would add complexity for not much gain).

const ROLES: TrainingRole[] = ['entrant', 'attendant', 'entry_supervisor', 'rescuer', 'other']

export default function TrainingRecordsPage() {
  const { profile, loading: authLoading } = useAuth()
  const [rows, setRows] = useState<TrainingRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [filterRole, setFilterRole] = useState<'' | TrainingRole>('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { data, error } = await supabase
      .from('loto_training_records')
      .select('*')
      .order('worker_name', { ascending: true })
      .order('role',        { ascending: true })
    if (error) {
      setLoadError(error.message)
      setRows([])
    } else {
      setRows((data ?? []) as TrainingRecord[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    load()
  }, [authLoading, profile, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  async function remove(row: TrainingRecord) {
    if (!confirm(`Remove ${row.worker_name}'s ${TRAINING_ROLE_LABELS[row.role]} cert?`)) return
    const { error } = await supabase
      .from('loto_training_records')
      .delete()
      .eq('id', row.id)
    if (error) { setLoadError(error.message); return }
    setRows(prev => prev.filter(r => r.id !== row.id))
  }

  // Client-side filter — the table is small (typically ≤ a few hundred
  // certs even at full-site scale), so filtering in JS keeps the UX
  // snappy without round-tripping the server on every keystroke.
  const q = search.trim().toLowerCase()
  const visible = rows.filter(r => {
    if (filterRole && r.role !== filterRole) return false
    if (!q) return true
    return r.worker_name.toLowerCase().includes(q)
  })

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3 flex-wrap">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <GraduationCap className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Training records
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            §1910.146(g) — entrant / attendant / supervisor / rescuer training certifications.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add record
        </button>
      </header>

      {loadError && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{loadError}</p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by worker name…"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
        <select
          value={filterRole}
          onChange={e => setFilterRole(e.target.value as '' | TrainingRole)}
          className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="">All roles</option>
          {ROLES.map(r => <option key={r} value={r}>{TRAINING_ROLE_LABELS[r]}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
      ) : visible.length === 0 ? (
        <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center space-y-1">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {rows.length === 0 ? 'No training records yet.' : 'No records match your filter.'}
          </p>
          {rows.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400">Add one to start enforcing the §(g) gate at permit-sign time.</p>
          )}
        </div>
      ) : (
        <ul className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {visible.map(row => {
            const expired = row.expires_at && row.expires_at < new Date().toISOString().slice(0, 10)
            return (
              <li key={row.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{row.worker_name}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {TRAINING_ROLE_LABELS[row.role]} · completed {row.completed_at}
                    {row.expires_at && (
                      <> · {expired ? <span className="text-rose-700 dark:text-rose-300 font-semibold">expired {row.expires_at}</span> : <>expires {row.expires_at}</>}</>
                    )}
                    {!row.expires_at && <> · no expiry</>}
                    {row.cert_authority && <> · {row.cert_authority}</>}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => remove(row)}
                  aria-label={`Remove ${row.worker_name}`}
                  className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors p-1"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {addOpen && (
        <AddDialog
          onClose={() => setAddOpen(false)}
          onAdded={(row) => {
            setRows(prev => [...prev, row].sort((a, b) =>
              a.worker_name.localeCompare(b.worker_name) || a.role.localeCompare(b.role),
            ))
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ── Add dialog ────────────────────────────────────────────────────────────

function AddDialog({
  onClose, onAdded,
}: {
  onClose: () => void
  onAdded: (row: TrainingRecord) => void
}) {
  const [workerName, setWorkerName]       = useState('')
  const [role, setRole]                   = useState<TrainingRole>('entrant')
  const [completedAt, setCompletedAt]     = useState(() => new Date().toISOString().slice(0, 10))
  const [expiresAt, setExpiresAt]         = useState('')
  const [certAuthority, setCertAuthority] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (!workerName.trim() || !completedAt) {
      setError('Worker name and completion date are required.')
      return
    }
    if (expiresAt && expiresAt < completedAt) {
      setError('Expiry date cannot be before completion date.')
      return
    }
    setSubmitting(true)
    const { data, error: err } = await supabase
      .from('loto_training_records')
      .insert({
        worker_name:    workerName.trim(),
        role,
        completed_at:   completedAt,
        expires_at:     expiresAt || null,
        cert_authority: certAuthority.trim() || null,
      })
      .select('*')
      .single()
    setSubmitting(false)
    if (err || !data) { setError(err?.message ?? 'Could not add record.'); return }
    onAdded(data as TrainingRecord)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 overflow-y-auto py-10">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Add training record</h2>
          <button type="button" onClick={onClose} className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-lg leading-none px-1" aria-label="Close">×</button>
        </header>

        <div className="space-y-3">
          <Field label="Worker name">
            <input
              type="text"
              value={workerName}
              onChange={e => setWorkerName(e.target.value)}
              placeholder="Maria Lopez"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <Field label="Role">
            <select
              value={role}
              onChange={e => setRole(e.target.value as TrainingRole)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {ROLES.map(r => <option key={r} value={r}>{TRAINING_ROLE_LABELS[r]}</option>)}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Completed">
              <input
                type="date"
                value={completedAt}
                onChange={e => setCompletedAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </Field>
            <Field label="Expires" hint="Optional — leave blank for no expiry">
              <input
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </Field>
          </div>

          <Field label="Cert authority" hint="Optional — who provided the training">
            <input
              type="text"
              value={certAuthority}
              onChange={e => setCertAuthority(e.target.value)}
              placeholder="ABC Safety Co."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
        </div>

        {error && <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} disabled={submitting} className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200">
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {submitting ? 'Adding…' : 'Add record'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
        {label}
        {hint && <span className="text-slate-400 dark:text-slate-500 font-normal ml-1.5">{hint}</span>}
      </span>
      {children}
    </label>
  )
}
