'use client'

import { useEffect, useState } from 'react'
import { ListTodo, Loader2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTenant } from '@/components/TenantProvider'
import { spawnActionFromThread, type EntityLinkType, searchEntities } from '@/lib/safetyBoards/client'

// One-click "create CAPA from this thread." The thread page renders
// this button; clicking opens a small dialog with the action fields
// (action_type, owner, due, optional incident if not already linked
// to one). On submit we POST and route to the action page.

interface Props {
  threadId:   string
  threadTitle: string
  // If the thread is already linked to an incident we use it; otherwise
  // the user must pick one inline.
  linkedEntityType: EntityLinkType | null
  linkedEntityId:   string | null
  onSpawned?: (action: { id: string; incident_id: string }) => void
}

const ACTION_TYPES = [
  { value: 'corrective', label: 'Corrective' },
  { value: 'preventive', label: 'Preventive' },
  { value: 'interim',    label: 'Interim'    },
] as const

const HIERARCHY = [
  { value: '',               label: '— select —' },
  { value: 'elimination',    label: 'Elimination' },
  { value: 'substitution',   label: 'Substitution' },
  { value: 'engineering',    label: 'Engineering' },
  { value: 'administrative', label: 'Administrative' },
  { value: 'ppe',            label: 'PPE' },
] as const

export default function SpawnActionButton({ threadId, threadTitle, linkedEntityType, linkedEntityId, onSpawned }: Props) {
  const { tenant } = useTenant()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inheritedIncident = linkedEntityType === 'incident' ? linkedEntityId : null

  const [actionType, setActionType] = useState<typeof ACTION_TYPES[number]['value']>('corrective')
  const [hierarchy,  setHierarchy]  = useState<string>('')
  const [description, setDescription] = useState('')
  const [dueAt, setDueAt] = useState('')
  const [incidentId, setIncidentId] = useState<string | null>(inheritedIncident)
  const [incidentLabel, setIncidentLabel] = useState('')
  const [incidentSearch, setIncidentSearch] = useState('')
  const [incidentResults, setIncidentResults] = useState<Array<{ id: string; label: string; sub: string }>>([])

  useEffect(() => {
    if (!tenant?.id || !open || !!inheritedIncident) return
    if (!incidentSearch.trim()) { setIncidentResults([]); return }
    const t = setTimeout(async () => {
      try {
        const items = await searchEntities(tenant.id, 'incident', incidentSearch.trim())
        setIncidentResults(items)
      } catch { /* ignore */ }
    }, 250)
    return () => clearTimeout(t)
  }, [tenant?.id, open, incidentSearch, inheritedIncident])

  async function submit() {
    if (!tenant?.id) return
    if (!inheritedIncident && !incidentId) {
      setError('Pick an incident — corrective actions need a parent incident.')
      return
    }
    setBusy(true); setError(null)
    try {
      const r = await spawnActionFromThread(tenant.id, threadId, {
        action_type:           actionType,
        description:           description.trim() || undefined,
        hierarchy_of_controls: (hierarchy || null) as 'elimination' | 'substitution' | 'engineering' | 'administrative' | 'ppe' | null,
        due_at:                dueAt ? new Date(dueAt).toISOString() : null,
        incident_id:           incidentId ?? undefined,
      })
      onSpawned?.({ id: r.action.id, incident_id: r.incident_id })
      setOpen(false)
      router.push(`/incidents/${r.incident_id}/actions`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-700"
      >
        <ListTodo className="h-3.5 w-3.5" />
        Create action
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <header className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
              <h3 className="font-semibold text-slate-900 dark:text-slate-100">Create action from thread</h3>
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="p-4 space-y-3">
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Spawning a CAPA from <span className="font-medium">&ldquo;{threadTitle}&rdquo;</span>. The new action will link back to this thread.
              </p>

              {!inheritedIncident && (
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Incident</span>
                  {incidentId ? (
                    <div className="mt-1 flex items-center justify-between rounded ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-1 text-sm">
                      <span className="truncate">{incidentLabel}</span>
                      <button type="button" onClick={() => { setIncidentId(null); setIncidentLabel(''); setIncidentSearch('') }} className="text-slate-400 hover:text-rose-500">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <input
                        value={incidentSearch}
                        onChange={e => setIncidentSearch(e.target.value)}
                        placeholder="Search by report number or title…"
                        className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
                      />
                      {incidentResults.length > 0 && (
                        <ul className="mt-1 max-h-40 overflow-y-auto rounded ring-1 ring-slate-200 dark:ring-slate-700">
                          {incidentResults.map(r => (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => { setIncidentId(r.id); setIncidentLabel(r.label) }}
                                className="w-full text-left rounded px-2 py-1 text-sm hover:bg-slate-50 dark:hover:bg-slate-800"
                              >
                                <div className="font-medium">{r.label}</div>
                                {r.sub && <div className="text-xs text-slate-500 dark:text-slate-400">{r.sub}</div>}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </label>
              )}

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
                  <select
                    value={actionType}
                    onChange={e => setActionType(e.target.value as typeof actionType)}
                    className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
                  >
                    {ACTION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Hierarchy</span>
                  <select
                    value={hierarchy}
                    onChange={e => setHierarchy(e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
                  >
                    {HIERARCHY.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
                  </select>
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description (optional — defaults to thread title)</span>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Due date (optional)</span>
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={e => setDueAt(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
                />
              </label>

              {error && <p className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-1.5 text-sm">Cancel</button>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-1"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create action
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
