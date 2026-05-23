'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CalendarClock, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import {
  classifyUrgency,
  daysUntilDue,
  type ObligationCadence,
  type ObligationUrgency,
} from '@soteria/core/complianceCalendar'

interface Obligation {
  id:             string
  title:          string
  description:    string | null
  regulatory_ref: string | null
  category:       string
  cadence:        ObligationCadence
  cadence_days:   number | null
  next_due_at:    string
  owner_user_id:  string | null
  site_label:     string | null
  status:         string
  source:         'system' | 'tenant'
  system_key:     string | null
}

const CADENCE_OPTIONS: ObligationCadence[] = [
  'once', 'monthly', 'quarterly', 'semiannual', 'annual', 'biennial', 'triennial', 'quinquennial',
]

async function authedHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'content-type': 'application/json',
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

const URGENCY_GROUPS: { key: ObligationUrgency; label: string; tone: string }[] = [
  { key: 'overdue',  label: 'Overdue',   tone: 'text-rose-700 dark:text-rose-300' },
  { key: 'due_soon', label: 'Due soon',  tone: 'text-amber-700 dark:text-amber-300' },
  { key: 'upcoming', label: 'Upcoming',  tone: 'text-slate-600 dark:text-slate-300' },
]

export default function ComplianceCalendarPage() {
  const { tenantId } = useTenant()
  const [obligations, setObligations] = useState<Obligation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/compliance/obligations', { headers: await authedHeaders(tenantId) })
      if (!res.ok) throw new Error(`Failed to load (${res.status})`)
      const json = await res.json()
      setObligations(json.obligations ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load obligations')
    } finally {
      setLoading(false)
    }
  }, [tenantId])

  useEffect(() => { load() }, [load])

  const open = useMemo(() => obligations.filter(o => o.status === 'open'), [obligations])
  const grouped = useMemo(() => {
    const now = new Date()
    const by: Record<ObligationUrgency, Obligation[]> = { overdue: [], due_soon: [], upcoming: [] }
    for (const o of open) by[classifyUrgency(o.next_due_at, now)].push(o)
    return by
  }, [open])

  const overdueCount = grouped.overdue.length

  async function complete(o: Obligation) {
    if (!tenantId) return
    setBusyId(o.id)
    try {
      const res = await fetch(`/api/compliance/obligations/${o.id}/complete`, {
        method: 'POST', headers: await authedHeaders(tenantId), body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`Complete failed (${res.status})`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to complete')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(o: Obligation) {
    if (!tenantId) return
    setBusyId(o.id)
    try {
      const res = await fetch(`/api/compliance/obligations/${o.id}`, {
        method: 'DELETE', headers: await authedHeaders(tenantId),
      })
      if (!res.ok) throw new Error(`Delete failed (${res.status})`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Compliance</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <CalendarClock className="h-5 w-5" /> Compliance Calendar
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Recurring regulatory and tenant-defined obligations, with owners and due dates.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> Add obligation
        </button>
      </header>

      {overdueCount > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/20 px-3 py-2 text-sm font-medium text-rose-800 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4" />
          {overdueCount} obligation{overdueCount === 1 ? '' : 's'} overdue.
        </div>
      )}

      {showAdd && tenantId && (
        <AddObligationForm
          tenantId={tenantId}
          onCreated={() => { setShowAdd(false); load() }}
          onError={setError}
        />
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{error}</p>
      )}

      {loading ? (
        <div className="mt-6 space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-16 rounded-lg bg-slate-100 dark:bg-slate-800 animate-pulse" />)}
        </div>
      ) : open.length === 0 ? (
        <p className="mt-6 text-sm text-slate-500 dark:text-slate-400">No open obligations. Add one, or enable a module to seed its regulatory deadlines.</p>
      ) : (
        <div className="mt-6 space-y-6">
          {URGENCY_GROUPS.map(group => grouped[group.key].length > 0 && (
            <section key={group.key}>
              <h2 className={`text-xs font-bold uppercase tracking-wider ${group.tone}`}>
                {group.label} ({grouped[group.key].length})
              </h2>
              <ul className="mt-2 divide-y divide-slate-200 dark:divide-slate-800 rounded-lg border border-slate-200 dark:border-slate-800">
                {grouped[group.key].map(o => (
                  <ObligationRow
                    key={o.id}
                    o={o}
                    busy={busyId === o.id}
                    onComplete={() => complete(o)}
                    onDelete={() => remove(o)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ObligationRow({ o, busy, onComplete, onDelete }: {
  o: Obligation; busy: boolean; onComplete: () => void; onDelete: () => void
}) {
  const days = daysUntilDue(o.next_due_at)
  const dueLabel = days < 0
    ? `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`
    : days === 0 ? 'Due today' : `Due in ${days} day${days === 1 ? '' : 's'}`
  return (
    <li className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-900 dark:text-slate-100">{o.title}</span>
          {o.source === 'system' && (
            <span className="rounded border border-slate-300 dark:border-slate-700 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500">Regulatory</span>
          )}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {o.next_due_at} · {dueLabel}
          {o.regulatory_ref ? ` · ${o.regulatory_ref}` : ''}
          {o.site_label ? ` · ${o.site_label}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onComplete}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-md border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> Mark done
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          aria-label="Delete obligation"
          className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-400 hover:text-rose-600 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  )
}

function AddObligationForm({ tenantId, onCreated, onError }: {
  tenantId: string; onCreated: () => void; onError: (m: string) => void
}) {
  const [title, setTitle] = useState('')
  const [nextDueAt, setNextDueAt] = useState('')
  const [cadence, setCadence] = useState<ObligationCadence>('annual')
  const [regulatoryRef, setRegulatoryRef] = useState('')
  const [siteLabel, setSiteLabel] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch('/api/compliance/obligations', {
        method: 'POST',
        headers: await authedHeaders(tenantId),
        body: JSON.stringify({
          title, next_due_at: nextDueAt, cadence,
          regulatory_ref: regulatoryRef || null, site_label: siteLabel || null,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ? `Could not save: ${j.error}` : `Could not save (${res.status})`)
      }
      onCreated()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save obligation')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 p-4 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">
        <span className="font-medium text-slate-700 dark:text-slate-300">Title</span>
        <input required value={title} onChange={e => setTitle(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-300">Next due</span>
        <input required type="date" value={nextDueAt} onChange={e => setNextDueAt(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-300">Repeats</span>
        <select value={cadence} onChange={e => setCadence(e.target.value as ObligationCadence)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm">
          {CADENCE_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-300">Regulatory ref (optional)</span>
        <input value={regulatoryRef} onChange={e => setRegulatoryRef(e.target.value)} placeholder="e.g. 29 CFR 1904.32"
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      </label>
      <label className="text-sm">
        <span className="font-medium text-slate-700 dark:text-slate-300">Site (optional)</span>
        <input value={siteLabel} onChange={e => setSiteLabel(e.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm" />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={saving}
          className="rounded-lg bg-brand-navy px-3 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save obligation'}
        </button>
      </div>
    </form>
  )
}
