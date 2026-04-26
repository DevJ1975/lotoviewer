'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type { ConfinedSpace, ConfinedSpaceClassification, ConfinedSpaceType } from '@/lib/types'
import { SPACE_TYPE_LABELS, CLASSIFICATION_LABELS } from '@/lib/confinedSpaceLabels'
import { DepartmentPicker } from '@/components/DepartmentPicker'

// First slice of the Confined Space module per OSHA 29 CFR 1910.146.
// Single-pane list view with a department filter and an inline "Add space"
// dialog so the user can seed data immediately. Three-pane preview layout
// (matching /) is a follow-up — list + detail-page link is enough to
// validate the shape end-to-end first.

// Visual scheme picked to make the OSHA classification obvious at a glance —
// the difference between permit-required and non-permit is the difference
// between needing a written permit + attendant + atmospheric tests and not.
function ClassificationBadge({ value }: { value: ConfinedSpaceClassification }) {
  const cls =
    value === 'permit_required' ? 'bg-rose-100 text-rose-800'
  : value === 'reclassified'    ? 'bg-amber-100 text-amber-800'
  :                                'bg-slate-100 text-slate-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {CLASSIFICATION_LABELS[value]}
    </span>
  )
}

export default function ConfinedSpacesPage() {
  const [spaces, setSpaces]       = useState<ConfinedSpace[]>([])
  const [loading, setLoading]     = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [filterDept, setFilterDept] = useState<string | null>(null)
  const [query, setQuery]         = useState('')
  const [addOpen, setAddOpen]     = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('loto_confined_spaces')
      .select('*')
      .eq('decommissioned', false)
      .order('space_id', { ascending: true })
    if (error) {
      console.error('[confined-spaces] load failed', error)
      setLoadError(true)
    } else if (data) {
      setSpaces(data as ConfinedSpace[])
      setLoadError(false)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const departments = useMemo(() => {
    const set = new Set<string>()
    for (const s of spaces) set.add(s.department)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [spaces])

  // Combined dept-filter + free-text search. The text search matches
  // space_id, description, and department case-insensitively — the three
  // fields a supervisor is likely to remember when hunting for a space.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return spaces.filter(s => {
      if (filterDept && s.department !== filterDept) return false
      if (!q) return true
      return (
        s.space_id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.department.toLowerCase().includes(q)
      )
    })
  }, [spaces, filterDept, query])

  if (loadError) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-10 text-center">
        <p className="text-sm font-semibold text-slate-700 mb-1">Could not load confined spaces.</p>
        <p className="text-xs text-slate-500 mb-4">Migration 009 may not be applied yet — check the Supabase SQL Editor.</p>
        <button
          type="button"
          onClick={() => { setLoading(true); load() }}
          className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Confined Spaces</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Permit-required confined spaces inventory · OSHA 29 CFR 1910.146
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <Link
            href="/confined-spaces/import"
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Import CSV
          </Link>
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            + Add space
          </button>
        </div>
      </header>

      {/* Search bar — visible whenever there's at least one space, since
          a single-row inventory still benefits from the affordance and a
          supervisor with 50+ rows depends on it. */}
      {spaces.length > 0 && (
        <div className="relative">
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search by ID, description, or department…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">⌕</span>
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 text-sm px-1"
            >
              ×
            </button>
          )}
        </div>
      )}

      {departments.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          <DeptChip label="All" active={filterDept === null} onClick={() => setFilterDept(null)} />
          {departments.map(d => (
            <DeptChip key={d} label={d} active={filterDept === d} onClick={() => setFilterDept(d)} />
          ))}
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
      ) : visible.length === 0 ? (
        <div className="py-12 text-center space-y-2">
          {spaces.length === 0 ? (
            <>
              <p className="text-sm font-semibold text-slate-700">No confined spaces yet.</p>
              <p className="text-xs text-slate-400">Add your first space to start managing entry permits.</p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-slate-700">No spaces match your filter.</p>
              <p className="text-xs text-slate-400">Try a different search term or clear the department filter.</p>
            </>
          )}
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white overflow-hidden">
          {visible.map(s => (
            <li key={s.space_id}>
              <Link
                href={`/confined-spaces/${encodeURIComponent(s.space_id)}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-sm font-bold text-slate-900">{s.space_id}</span>
                    <ClassificationBadge value={s.classification} />
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      {SPACE_TYPE_LABELS[s.space_type]}
                    </span>
                  </div>
                  <p className="text-sm text-slate-700 truncate mt-0.5">{s.description}</p>
                  <p className="text-[11px] text-slate-400">{s.department}</p>
                </div>
                <span className="text-slate-300 text-lg">›</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {addOpen && (
        <AddSpaceDialog
          existingIds={new Set(spaces.map(s => s.space_id))}
          knownDepartments={departments}
          onClose={() => setAddOpen(false)}
          onAdded={(row) => {
            setSpaces(prev =>
              [...prev, row].sort((a, b) => a.space_id.localeCompare(b.space_id)),
            )
            setAddOpen(false)
          }}
        />
      )}
    </div>
  )
}

function DeptChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
        active
          ? 'bg-brand-navy text-white'
          : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

// ── Add dialog ──────────────────────────────────────────────────────────────
// Inline rather than a sheet — this is a smaller form than AddEquipmentDialog
// and the page has the room. The full edit experience (photos, AI hazards,
// internal notes) lives on the detail page.

interface AddProps {
  existingIds:      Set<string>
  knownDepartments: string[]
  onClose:          () => void
  onAdded:          (row: ConfinedSpace) => void
}

function AddSpaceDialog({ existingIds, knownDepartments, onClose, onAdded }: AddProps) {
  const [spaceId, setSpaceId]               = useState('')
  const [description, setDescription]       = useState('')
  const [department, setDepartment]         = useState('')
  const [spaceType, setSpaceType]           = useState<ConfinedSpaceType>('tank')
  const [classification, setClassification] = useState<ConfinedSpaceClassification>('permit_required')
  const [submitting, setSubmitting]         = useState(false)
  const [serverError, setServerError]       = useState<string | null>(null)

  const trimmedId   = spaceId.trim()
  const trimmedDesc = description.trim()
  const trimmedDept = department.trim()
  const duplicate   = trimmedId.length > 0 && existingIds.has(trimmedId)
  const canSubmit   = !duplicate
                   && trimmedId.length > 0
                   && trimmedDesc.length > 0
                   && trimmedDept.length > 0
                   && !submitting

  async function handleSubmit() {
    if (!canSubmit) return
    setSubmitting(true)
    setServerError(null)

    const payload = {
      space_id:       trimmedId,
      description:    trimmedDesc,
      department:     trimmedDept,
      space_type:     spaceType,
      classification: classification,
    }

    const { data, error } = await supabase
      .from('loto_confined_spaces')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      setServerError(error.message)
      setSubmitting(false)
      return
    }

    onAdded(data as ConfinedSpace)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Add Confined Space</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="space-y-3">
          <Field label="Space ID" hint="e.g. CS-MIX-04">
            <input
              type="text"
              value={spaceId}
              onChange={e => setSpaceId(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
            {duplicate && (
              <p className="text-[11px] text-rose-600 mt-1">A space with this ID already exists.</p>
            )}
          </Field>

          <Field label="Description">
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="South side mixing tank #4"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <Field label="Department">
            <DepartmentPicker
              value={department}
              onChange={setDepartment}
              knownDepartments={knownDepartments}
              placeholder="Packaging"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={spaceType}
                onChange={e => setSpaceType(e.target.value as ConfinedSpaceType)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              >
                {Object.entries(SPACE_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </Field>

            <Field label="Classification">
              <select
                value={classification}
                onChange={e => setClassification(e.target.value as ConfinedSpaceClassification)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              >
                {Object.entries(CLASSIFICATION_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        {serverError && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{serverError}</p>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            {submitting ? 'Adding…' : 'Add space'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600">
        {label}
        {hint && <span className="text-slate-400 font-normal ml-1.5">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
