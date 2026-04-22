'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Archive, ArchiveRestore, ArrowLeft, Check, Loader2, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'
import { useDebounce } from '@/hooks/useDebounce'
import { useToast } from '@/hooks/useToast'
import Toast from '@/components/Toast'
import { haptic } from '@/lib/platform'

export default function DecommissionPage() {
  const [equipment, setEquipment]     = useState<Equipment[]>([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState(false)
  const [schemaError, setSchemaError] = useState(false)
  const [pending, setPending]         = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected]       = useState<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy]       = useState(false)
  const [search, setSearch]           = useState('')
  const debounced                     = useDebounce(search, 200)
  const { toast, showToast, clearToast } = useToast()

  const fetchData = useCallback(async () => {
    const { data, error } = await supabase
      .from('loto_equipment')
      .select('*')
      .order('equipment_id', { ascending: true })
    if (error) {
      console.error('[decommission] fetch failed', error)
      setLoadError(true)
    } else if (data) {
      // Hard schema check: if the `decommissioned` column is missing from the
      // DB or PostgREST's schema cache, every row comes back without the
      // property and counters look fine (all "active") — but writes then
      // silently do nothing. Detect it up front so the user can't be fooled.
      const rows = data as Equipment[]
      const missing = rows.length > 0 && rows.every(r => !('decommissioned' in r))
      setSchemaError(missing)
      setEquipment(rows)
      setLoadError(false)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const active = equipment.filter(e => !e.decommissioned).length
  const decommissionedCount = equipment.length - active

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase()
    if (!q) return equipment
    return equipment.filter(e =>
      e.equipment_id.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q),
    )
  }, [equipment, debounced])

  const grouped = useMemo(() => {
    const byDept = new Map<string, Equipment[]>()
    for (const e of filtered) {
      const list = byDept.get(e.department) ?? []
      list.push(e)
      byDept.set(e.department, list)
    }
    return [...byDept.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dept, rows]) => ({
        dept,
        rows: rows.sort((a, b) => a.equipment_id.localeCompare(b.equipment_id)),
        decommCount: rows.filter(r => r.decommissioned).length,
      }))
  }, [filtered])

  // Flat ordered list of equipment_ids for arrow-key navigation.
  const orderedIds = useMemo(
    () => grouped.flatMap(g => g.rows.map(r => r.equipment_id)),
    [grouped],
  )

  const rowRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())

  // Internal: optimistic update + persist + rollback. Pure side effect with
  // a known `next` value — caller is responsible for tracking the previous
  // value (read from current state) for undo. Setter callback runs twice
  // under React Strict Mode, so we don't read state from inside it.
  const setDecommissionedRaw = useCallback(async (id: string, next: boolean): Promise<string | null> => {
    setEquipment(prev => prev.map(eq =>
      eq.equipment_id === id ? { ...eq, decommissioned: next } : eq,
    ))
    setPending(prev => { const s = new Set(prev); s.add(id); return s })

    // .select() forces Supabase to return the updated rows. Without it, a
    // zero-row UPDATE (RLS denial, expired JWT, stale schema cache) silently
    // returns { error: null, data: null } — the UI looks fine but nothing
    // persists. Selecting BOTH equipment_id AND decommissioned lets us also
    // verify the persisted value matches what we asked for: if a trigger or
    // BEFORE UPDATE rule overrode our value, we catch it here instead of at
    // the next page refresh.
    console.log('[decommission] PATCH start', { id, next })
    const { data, error } = await supabase
      .from('loto_equipment')
      .update({ decommissioned: next })
      .eq('equipment_id', id)
      .select('equipment_id, decommissioned')
    console.log('[decommission] PATCH result', { id, next, data, error })

    setPending(prev => { const s = new Set(prev); s.delete(id); return s })

    if (error) {
      console.error('[decommission] write failed', { id, next, error })
      setEquipment(prev => prev.map(eq =>
        eq.equipment_id === id ? { ...eq, decommissioned: !next } : eq,
      ))
      return error.message
    }
    if (!data || data.length === 0) {
      console.error('[decommission] write returned 0 rows', { id, next })
      setEquipment(prev => prev.map(eq =>
        eq.equipment_id === id ? { ...eq, decommissioned: !next } : eq,
      ))
      return 'Write was rejected (0 rows affected). Check you are signed in.'
    }
    const stored = (data[0] as { decommissioned?: boolean }).decommissioned
    if (stored !== next) {
      // Server accepted the request but the stored value does not match —
      // a trigger reverted it, or the column is missing from the schema
      // cache and Postgres silently ignored it.
      console.error('[decommission] value mismatch — server stored', stored, 'not', next)
      setEquipment(prev => prev.map(eq =>
        eq.equipment_id === id ? { ...eq, decommissioned: stored ?? !next } : eq,
      ))
      return `Server saved decommissioned=${stored} (expected ${next}). Run migration 002 or reload the Supabase schema cache.`
    }
    return null
  }, [])

  // Bulk apply — set the same `next` value for every selected id, with a
  // single optimistic patch and one round-trip per row. Reports the per-row
  // result count via toast and clears selection on completion.
  // Visible-only selection. `selected` is kept as a persistent Set across
  // searches, but bulk actions must only ever touch rows the user can
  // currently see — otherwise typing a search can invisibly bulk-update rows
  // that are filtered out of view. visibleIds comes from orderedIds (the
  // flattened grouped list), which is what the rendered DOM shows.
  const visibleIds = useMemo(() => new Set(orderedIds), [orderedIds])
  const effectiveSelected = useMemo(
    () => new Set([...selected].filter(id => visibleIds.has(id))),
    [selected, visibleIds],
  )

  const bulkApply = useCallback(async (next: boolean) => {
    if (bulkBusy) return
    // Snapshot the id set into a Set as well — every optimistic/rollback
    // branch reads from it via closure, and we must not let subsequent
    // `selected` mutations (user taps more rows while PATCH is in flight)
    // change the rows we're acting on mid-operation.
    const ids    = [...effectiveSelected]
    const idsSet = new Set(ids)
    if (ids.length === 0) return
    setBulkBusy(true)
    haptic('tap')

    setEquipment(prev => prev.map(eq =>
      idsSet.has(eq.equipment_id) ? { ...eq, decommissioned: next } : eq,
    ))

    // See setDecommissionedRaw for why .select() matters — otherwise an RLS
    // denial or expired session returns "success" with 0 rows written.
    // Also select `decommissioned` so we can verify the stored value matches.
    const { data, error } = await supabase
      .from('loto_equipment')
      .update({ decommissioned: next })
      .in('equipment_id', ids)
      .select('equipment_id, decommissioned')

    setBulkBusy(false)

    const failed = error != null || !data || data.length === 0
    if (failed) {
      console.error('[decommission] bulk write failed', { ids, next, error })
      setEquipment(prev => prev.map(eq =>
        idsSet.has(eq.equipment_id) ? { ...eq, decommissioned: !next } : eq,
      ))
      haptic('error')
      const msg = error
        ? error.message
        : 'Write was rejected (0 rows affected). Check you are signed in.'
      showToast(`Bulk update failed: ${msg}`, 'error')
      return
    }

    // Reconcile against BOTH row count and stored value. A row is "saved"
    // only if it came back AND the returned decommissioned value matches
    // what we tried to write. Otherwise we consider it rejected.
    const savedIds = new Set(
      data
        .filter(r => (r as { decommissioned?: boolean }).decommissioned === next)
        .map(r => r.equipment_id),
    )
    if (savedIds.size < ids.length) {
      console.error('[decommission] bulk partial/mismatch', { ids, saved: [...savedIds], returned: data })
      setEquipment(prev => prev.map(eq =>
        idsSet.has(eq.equipment_id) && !savedIds.has(eq.equipment_id)
          ? { ...eq, decommissioned: !next }
          : eq,
      ))
      haptic('error')
      const rejected = ids.length - savedIds.size
      showToast(
        `Saved ${savedIds.size} of ${ids.length}. ${rejected} rejected (check schema / RLS).`,
        'error',
      )
      setSelected(new Set())
      return
    }

    setSelected(new Set())
    showToast(
      `${ids.length} item${ids.length === 1 ? '' : 's'} ${next ? 'decommissioned' : 'restored'}.`,
      'success',
      { label: 'Undo', onClick: async () => {
        setEquipment(prev => prev.map(eq =>
          ids.includes(eq.equipment_id) ? { ...eq, decommissioned: !next } : eq,
        ))
        const { data: undoData, error: undoErr } = await supabase
          .from('loto_equipment')
          .update({ decommissioned: !next })
          .in('equipment_id', ids)
          .select('equipment_id')
        if (undoErr || !undoData || undoData.length === 0) {
          // Undo bounced too — put the optimistic state back and tell the user.
          setEquipment(prev => prev.map(eq =>
            ids.includes(eq.equipment_id) ? { ...eq, decommissioned: next } : eq,
          ))
          showToast('Undo failed. Original change kept.', 'error')
        }
      } },
    )
  }, [bulkBusy, effectiveSelected, showToast])

  const toggle = useCallback(async (id: string) => {
    console.log('[decommission] toggle invoked', { id })
    // Block if this row has an individual PATCH already in flight, OR if a
    // bulk op is running and this row is in that bulk set. Without the second
    // check, tapping the row's body (not its checkbox) while a bulk PATCH is
    // in flight would fire a concurrent individual PATCH on the same row,
    // and the later response wins — race.
    if (pending.has(id)) { console.log('[decommission] skip — already pending', id); return }
    if (bulkBusy && selected.has(id)) { console.log('[decommission] skip — bulk busy', id); return }
    const current = equipment.find(e => e.equipment_id === id)
    if (!current) { console.log('[decommission] skip — not in local state', id); return }
    const previous = current.decommissioned
    const next     = !previous
    console.log('[decommission] flipping', { id, previous, next })
    haptic('tap')

    const error = await setDecommissionedRaw(id, next)
    if (error) {
      haptic('error')
      showToast(`Could not update ${id}: ${error}`, 'error')
      return
    }
    showToast(
      next ? `${id} decommissioned.` : `${id} restored.`,
      'success',
      { label: 'Undo', onClick: async () => {
        // Undo runs the same write path, so surface its failures too —
        // otherwise a silently-rejected undo looks like the action didn't
        // undo, which is the exact symptom that started this bug hunt.
        const undoErr = await setDecommissionedRaw(id, previous)
        if (undoErr) {
          haptic('error')
          showToast(`Undo failed: ${undoErr}`, 'error')
        }
      } },
    )
  }, [pending, bulkBusy, selected, equipment, setDecommissionedRaw, showToast])

  const focusRow = (id: string) => {
    rowRefs.current.get(id)?.focus()
  }

  const onRowKeyDown = (e: React.KeyboardEvent<HTMLDivElement>, id: string) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      toggle(id)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const idx = orderedIds.indexOf(id)
      if (idx === -1) return
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(orderedIds.length - 1, idx + 1)
        : Math.max(0, idx - 1)
      focusRow(orderedIds[nextIdx])
    }
  }

  if (loadError) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center px-6 max-w-sm">
          <div className="w-14 h-14 rounded-full bg-rose-100 flex items-center justify-center text-2xl mx-auto mb-3">⚠</div>
          <p className="text-sm font-semibold text-slate-700 mb-1">Could not load equipment</p>
          <p className="text-xs text-slate-400 mb-4">Please check your connection and try again.</p>
          <button
            type="button"
            onClick={() => { setLoading(true); setLoadError(false); fetchData() }}
            className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-10 h-10 border-4 border-brand-navy border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-slate-400 hover:text-brand-navy transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Archive className="h-5 w-5 text-slate-500" />
              Decommission Mode
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Tap a row to retire it. Changes save immediately.
            </p>
          </div>
        </div>
      </header>

      {schemaError && (
        <div role="alert" className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 space-y-2">
          <p className="font-bold flex items-center gap-2">
            <span>⚠</span> Database schema is out of date
          </p>
          <p>
            The <code className="px-1 py-0.5 rounded bg-rose-100 font-mono text-xs">decommissioned</code> column
            isn&apos;t being returned for any equipment row. Decommission writes will not persist until this is fixed.
          </p>
          <p className="text-xs">
            Open the Supabase SQL editor and run{' '}
            <code className="px-1 py-0.5 rounded bg-rose-100 font-mono">migrations/002_decommissioned_and_indexes.sql</code>,
            then reload PostgREST&apos;s schema cache with{' '}
            <code className="px-1 py-0.5 rounded bg-rose-100 font-mono">NOTIFY pgrst, &apos;reload schema&apos;;</code>
          </p>
        </div>
      )}

      {/* Counter tiles */}
      <div className="grid grid-cols-3 gap-3">
        <CounterTile
          value={active}
          label="Active"
          valueClass="text-brand-navy"
          bgClass="bg-brand-navy/5"
        />
        <CounterTile
          value={decommissionedCount}
          label="Decommissioned"
          valueClass="text-amber-600"
          bgClass="bg-amber-50"
        />
        <CounterTile
          value={equipment.length}
          label="Total"
          valueClass="text-slate-500"
          bgClass="bg-muted/40"
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search equipment"
          className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
        />
      </div>

      {/* List */}
      {grouped.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          {equipment.length === 0
            ? 'No equipment to show.'
            : `No equipment matches "${debounced.trim()}".`}
        </div>
      ) : (
        <div className="rounded-xl bg-white ring-1 ring-slate-200 overflow-hidden">
          {grouped.map((group, gi) => (
            <section key={group.dept}>
              <div className={`sticky top-0 z-10 bg-slate-50/95 backdrop-blur px-4 py-2 flex items-center justify-between ${gi > 0 ? 'border-t border-slate-200' : ''}`}>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                  {group.dept}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.decommCount}/{group.rows.length} decommissioned
                </span>
              </div>
              <ul>
                {group.rows.map(eq => (
                  <li key={eq.equipment_id} className="border-t border-slate-100 first:border-t-0">
                    <DecommRow
                      eq={eq}
                      pending={pending.has(eq.equipment_id)}
                      isSelected={selected.has(eq.equipment_id)}
                      onToggle={() => toggle(eq.equipment_id)}
                      onSelectChange={chk => setSelected(prev => {
                        const s = new Set(prev)
                        if (chk) s.add(eq.equipment_id); else s.delete(eq.equipment_id)
                        return s
                      })}
                      onKeyDown={e => onRowKeyDown(e, eq.equipment_id)}
                      registerRef={el => { rowRefs.current.set(eq.equipment_id, el) }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Sticky bulk-actions bar — appears whenever rows are selected */}
      {selected.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="fixed left-0 right-0 bottom-0 z-40 bg-brand-navy text-white shadow-2xl border-t border-white/10"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3 flex-wrap">
            <div className="flex flex-col">
              <span className="text-sm font-semibold tabular-nums">
                {effectiveSelected.size} selected
              </span>
              {selected.size > effectiveSelected.size && (
                <span className="text-[11px] text-white/60 tabular-nums">
                  ({selected.size - effectiveSelected.size} hidden by search)
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-white/70 hover:text-white text-xs flex items-center gap-1"
              aria-label="Clear selection"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
            <div className="flex-1" />
            <button
              type="button"
              disabled={bulkBusy || effectiveSelected.size === 0}
              onClick={() => bulkApply(true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 text-amber-950 text-sm font-bold disabled:opacity-50 hover:bg-amber-400 transition-colors min-h-[40px]"
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}
              Decommission
            </button>
            <button
              type="button"
              disabled={bulkBusy || effectiveSelected.size === 0}
              onClick={() => bulkApply(false)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 text-white text-sm font-bold disabled:opacity-50 hover:bg-white/20 transition-colors min-h-[40px]"
            >
              {bulkBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveRestore className="h-4 w-4" />}
              Restore
            </button>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} onClose={clearToast} />}
    </div>
  )
}

interface CounterTileProps {
  value:      number
  label:      string
  valueClass: string
  bgClass:    string
}

function CounterTile({ value, label, valueClass, bgClass }: CounterTileProps) {
  return (
    <div className={`rounded-xl ${bgClass} px-5 py-4 text-center`}>
      <div className={`text-4xl font-bold tabular-nums leading-tight ${valueClass}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-sm text-muted-foreground mt-1">{label}</div>
    </div>
  )
}

interface DecommRowProps {
  eq:             Equipment
  pending:        boolean
  isSelected:     boolean
  onToggle:       () => void
  onSelectChange: (selected: boolean) => void
  onKeyDown:      (e: React.KeyboardEvent<HTMLDivElement>) => void
  registerRef:    (el: HTMLDivElement | null) => void
}

function DecommRow({ eq, pending, isSelected, onToggle, onSelectChange, onKeyDown, registerRef }: DecommRowProps) {
  const checked = eq.decommissioned
  return (
    <div
      ref={registerRef}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={pending}
      aria-label={`${eq.equipment_id} ${eq.description}`}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={`flex items-center gap-3 px-3 sm:px-4 py-3.5 min-h-[56px] cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/30 focus-visible:ring-inset ${
        isSelected ? 'bg-brand-navy/5 hover:bg-brand-navy/10' : checked ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-slate-50'
      }`}
    >
      {/* Multi-select checkbox — clicking it does NOT toggle decommissioned */}
      <label
        onClick={e => e.stopPropagation()}
        className="shrink-0 flex items-center justify-center h-9 w-9 -my-2 -ml-2 cursor-pointer"
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={e => onSelectChange(e.target.checked)}
          aria-label={`Select ${eq.equipment_id}`}
          className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy/30"
        />
      </label>
      <span
        aria-hidden="true"
        className={`shrink-0 h-5 w-5 rounded border flex items-center justify-center transition-colors ${
          checked
            ? 'bg-brand-navy border-brand-navy text-white'
            : 'bg-white border-slate-300'
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`font-mono text-sm font-bold truncate ${checked ? 'line-through text-muted-foreground' : 'text-brand-navy'}`}>
          {eq.equipment_id}
        </div>
        <div className={`text-xs truncate ${checked ? 'line-through text-muted-foreground' : 'text-slate-500'}`}>
          {eq.description}
        </div>
      </div>
      {pending && (
        <Loader2 className="h-4 w-4 text-slate-400 animate-spin shrink-0" aria-label="Saving" />
      )}
    </div>
  )
}
