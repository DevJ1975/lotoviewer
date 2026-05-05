'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import {
  HIERARCHY_LABELS,
  HIERARCHY_ORDER,
  type HierarchyLevel,
} from '@soteria/core/risk'

// /risk/controls — Controls Library admin page.
//
// Shows every control in the tenant's library (active + inactive)
// with edit + activate/deactivate + delete actions. Tenant
// admins can also add custom controls here without going through
// the wizard's free-text path.
//
// Hard delete is blocked when a control is referenced by any risk;
// the API returns 422 with code 'control_in_use' and the UI
// guides the user to deactivate instead.

interface LibraryControl {
  id:                    string
  hierarchy_level:       HierarchyLevel
  name:                  string
  description:           string | null
  regulatory_ref:        string | null
  applicable_categories: string[]
  active:                boolean
  created_at:            string
  updated_at:            string
}

const HAZARD_CATS = [
  'physical','chemical','biological','mechanical','electrical',
  'ergonomic','psychosocial','environmental','radiological',
] as const

export default function ControlsLibraryPage() {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin || !!profile?.is_superadmin

  const [controls, setControls] = useState<LibraryControl[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [showAdd,  setShowAdd]  = useState(false)
  const [editing,  setEditing]  = useState<LibraryControl | null>(null)
  const [toast,    setToast]    = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenant?.id)            headers['x-active-tenant'] = tenant.id
      const res = await fetch('/api/risk/controls-library?include_inactive=1', { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setControls((body.controls ?? []) as LibraryControl[])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant?.id])

  useEffect(() => { void refresh() }, [refresh])

  async function handleSetActive(id: string, active: boolean) {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/risk/controls-library/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type':     'application/json',
          authorization:      `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant':  tenant?.id ?? '',
        },
        body: JSON.stringify({ active }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`)
      setToast(active ? 'Control reactivated' : 'Control deactivated')
      void refresh()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Update failed')
    }
  }

  async function handleDelete(c: LibraryControl) {
    if (!confirm(`Permanently delete "${c.name}"? This cannot be undone. To preserve audit history, deactivate instead.`)) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`/api/risk/controls-library/${c.id}`, {
        method: 'DELETE',
        headers: {
          authorization:      `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant':  tenant?.id ?? '',
        },
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (body.code === 'control_in_use') {
          setToast(body.error)
          return
        }
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setToast(`Deleted ${c.name}`)
      void refresh()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const groupedByLevel = useMemo(() => {
    const groups: Record<HierarchyLevel, LibraryControl[]> = {
      elimination: [], substitution: [], engineering: [], administrative: [], ppe: [],
    }
    for (const c of controls) groups[c.hierarchy_level].push(c)
    return groups
  }, [controls])

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/risk"
            className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-3 w-3" /> Heat map
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            Controls Library
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Tenant-scoped catalog of available controls (ISO 45001 8.1.2 hierarchy).
            The wizard's “Suggested controls” panel pulls from active entries here.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowAdd(true)}
            className="text-sm font-bold inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90"
          >
            <Plus className="h-4 w-4" /> Add custom control
          </button>
        )}
      </header>

      {error && <p className="text-sm text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

      {loading && controls.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        </div>
      ) : (
        HIERARCHY_ORDER.map(level => {
          const items = groupedByLevel[level]
          return (
            <section
              key={level}
              className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5 space-y-3"
            >
              <h2 className="text-[10px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400">
                {HIERARCHY_LABELS[level]} ({items.length})
              </h2>
              {items.length === 0 ? (
                <p className="text-xs text-slate-400 italic">No controls in this tier.</p>
              ) : (
                <ul className="space-y-2">
                  {items.map(c => (
                    <ControlRow
                      key={c.id}
                      control={c}
                      isAdmin={isAdmin}
                      onEdit={() => setEditing(c)}
                      onSetActive={(a) => void handleSetActive(c.id, a)}
                      onDelete={() => void handleDelete(c)}
                    />
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}

      {showAdd && (
        <ControlEditModal
          mode="create"
          onClose={() => setShowAdd(false)}
          onSaved={(msg) => { setShowAdd(false); setToast(msg); void refresh() }}
        />
      )}
      {editing && (
        <ControlEditModal
          mode="edit"
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setToast(msg); void refresh() }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-4 right-4 bg-slate-900 text-white text-sm px-3 py-2 rounded-lg shadow-lg cursor-pointer"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </main>
  )
}

// ─── ControlRow ────────────────────────────────────────────────────────────

function ControlRow({
  control, isAdmin, onEdit, onSetActive, onDelete,
}: {
  control:     LibraryControl
  isAdmin:     boolean
  onEdit:      () => void
  onSetActive: (active: boolean) => void
  onDelete:    () => void
}) {
  return (
    <li className={
      'border rounded-lg p-3 ' +
      (control.active
        ? 'border-slate-200 dark:border-slate-700'
        : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 opacity-70')
    }>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              {control.name}
            </span>
            {!control.active && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 text-slate-700">
                Inactive
              </span>
            )}
            {control.regulatory_ref && (
              <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                {control.regulatory_ref}
              </span>
            )}
          </div>
          {control.description && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{control.description}</p>
          )}
          {control.applicable_categories.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {control.applicable_categories.map(c => (
                <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 capitalize">
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        {isAdmin && (
          <div className="flex flex-col items-end gap-1 shrink-0 text-[11px]">
            <button type="button" onClick={onEdit} className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline">
              Edit
            </button>
            <button
              type="button"
              onClick={() => onSetActive(!control.active)}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline"
            >
              {control.active ? 'Deactivate' : 'Reactivate'}
            </button>
            <button type="button" onClick={onDelete} className="text-rose-700 hover:text-rose-900 underline">
              Delete
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

// ─── ControlEditModal ──────────────────────────────────────────────────────

function ControlEditModal({
  mode, existing, onClose, onSaved,
}: {
  mode:      'create' | 'edit'
  existing?: LibraryControl
  onClose:   () => void
  onSaved:   (msg: string) => void
}) {
  const { tenant } = useTenant()
  const [name, setName]                 = useState(existing?.name ?? '')
  const [description, setDescription]   = useState(existing?.description ?? '')
  const [hierarchy, setHierarchy]       = useState<HierarchyLevel>(existing?.hierarchy_level ?? 'engineering')
  const [regulatoryRef, setRegRef]      = useState(existing?.regulatory_ref ?? '')
  const [categories, setCategories]     = useState<string[]>(existing?.applicable_categories ?? [])
  const [busy, setBusy]                 = useState(false)
  const [error, setError]               = useState<string | null>(null)

  const valid = name.trim().length > 0

  function toggleCategory(c: string) {
    setCategories(cs => cs.includes(c) ? cs.filter(x => x !== c) : [...cs, c])
  }

  async function submit() {
    if (busy || !valid) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const url    = mode === 'create' ? '/api/risk/controls-library' : `/api/risk/controls-library/${existing!.id}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type':     'application/json',
          authorization:      `Bearer ${session?.access_token ?? ''}`,
          'x-active-tenant':  tenant?.id ?? '',
        },
        body: JSON.stringify({
          hierarchy_level:       hierarchy,
          name:                  name.trim(),
          description:           description.trim(),
          regulatory_ref:        regulatoryRef.trim(),
          applicable_categories: categories,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      onSaved(mode === 'create' ? 'Control added' : 'Control updated')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <header className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-bold">
            {mode === 'create' ? 'Add custom control' : `Edit "${existing?.name}"`}
          </h3>
          <button onClick={onClose} aria-label="Close" className="text-slate-400 hover:text-slate-800">
            <X className="h-5 w-5" />
          </button>
        </header>

        <Field label="Hierarchy level" required>
          <select
            value={hierarchy}
            onChange={e => setHierarchy(e.target.value as HierarchyLevel)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          >
            {HIERARCHY_ORDER.map(l => (
              <option key={l} value={l}>{HIERARCHY_LABELS[l]}</option>
            ))}
          </select>
        </Field>

        <Field label="Name" required>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. SCBA respirator with 4 hr supply"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={3}
            placeholder="Optional — appears as a tooltip in the wizard."
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Regulatory reference">
          <input
            type="text"
            value={regulatoryRef}
            onChange={e => setRegRef(e.target.value)}
            placeholder="e.g. OSHA 1910.134(g)"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm font-mono"
          />
        </Field>

        <Field label="Applicable hazard categories" hint="Powers the wizard's “suggested controls” filter.">
          <div className="flex flex-wrap gap-1.5">
            {HAZARD_CATS.map(c => {
              const active = categories.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={
                    'text-xs px-2 py-1 rounded-md border transition-colors capitalize ' +
                    (active
                      ? 'bg-brand-navy text-white border-brand-navy'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700')
                  }
                >
                  {c}
                </button>
              )
            })}
          </div>
        </Field>

        {error && <p className="text-sm text-rose-700 bg-rose-50 px-3 py-2 rounded-lg">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-slate-600 dark:text-slate-300 px-3 py-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !valid}
            onClick={() => void submit()}
            className="bg-brand-navy text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-brand-navy/90"
          >
            {busy ? 'Saving…' : (mode === 'create' ? 'Add control' : 'Save changes')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({
  label, hint, required, children,
}: {
  label:    string
  hint?:    string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
        {label}{required && <span className="text-rose-600 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
    </div>
  )
}
