'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Archive, ArchiveRestore, ArrowLeft, Loader2, Search, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { loadAllEquipment } from '@/lib/queries/equipment'
import type { Equipment } from '@soteria/core/types'
import { useDebounce } from '@/hooks/useDebounce'
import { useToast } from '@/hooks/useToast'
import { useVisibilityRefetch } from '@/hooks/useVisibilityRefetch'
import Toast from '@/components/Toast'
import { haptic } from '@/lib/platform'
import { DecommissionSkeleton } from '@/components/Skeleton'
import { isOffline, OFFLINE_WRITE_MESSAGE } from '@/lib/netGuard'
import { debug } from '@/lib/debug'
import { CounterTile } from './_components/CounterTile'
import { DecommRow }   from './_components/DecommRow'

// Module-level marker so non-production builds can confirm the latest JS
// actually loaded (stale Vercel edge cache, SW cache, or browser HTTP cache
// otherwise look identical). The build SHA comes from Vercel automatically;
// no hand-bumping required. debug() is stripped in production builds so
// shipped users see a clean console.
if (typeof window !== 'undefined') {
  debug('[decommission] module loaded', {
    build: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
  })
}

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
    try {
      const rows = await loadAllEquipment()
      // Hard schema check: if the `decommissioned` column is missing from the
      // DB or PostgREST's schema cache, every row comes back without the
      // property and counters look fine (all "active") — but writes then
      // silently do nothing. Detect it up front so the user can't be fooled.
      const missing = rows.length > 0 && rows.every(r => !('decommissioned' in r))
      setSchemaError(missing)
      setEquipment(rows)
      setLoadError(false)
    } catch (err) {
      console.error('[decommission] fetch failed', err)
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useVisibilityRefetch(fetchData)

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
    debug('[decommission] PATCH start', { id, next })
    const { data, error } = await supabase
      .from('loto_equipment')
      .update({ decommissioned: next })
      .eq('equipment_id', id)
      .select('equipment_id, decommissioned')
    debug('[decommission] PATCH result', { id, next, data, error })

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
    if (isOffline()) {
      haptic('error')
      showToast(OFFLINE_WRITE_MESSAGE, 'error')
      return
    }
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
    debug('[decommission] toggle invoked', { id })
    // Block if this row has an individual PATCH already in flight, OR if a
    // bulk op is running and this row is in that bulk set. Without the second
    // check, tapping the row's body (not its checkbox) while a bulk PATCH is
    // in flight would fire a concurrent individual PATCH on the same row,
    // and the later response wins — race.
    if (pending.has(id)) { debug('[decommission] skip — already pending', id); return }
    if (bulkBusy && selected.has(id)) { debug('[decommission] skip — bulk busy', id); return }
    if (isOffline()) {
      haptic('error')
      showToast(OFFLINE_WRITE_MESSAGE, 'error')
      return
    }
    const current = equipment.find(e => e.equipment_id === id)
    if (!current) { debug('[decommission] skip — not in local state', id); return }
    const previous = current.decommissioned
    const next     = !previous
    debug('[decommission] flipping', { id, previous, next })
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
          <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/40 flex items-center justify-center text-2xl mx-auto mb-3">⚠</div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Could not load equipment</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">Please check your connection and try again.</p>
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

  if (loading) return <DecommissionSkeleton />

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link
            href="/loto"
            className="text-slate-400 dark:text-slate-500 hover:text-brand-navy transition-colors"
            aria-label="Back to LOTO dashboard"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Archive className="h-5 w-5 text-slate-500 dark:text-slate-400" />
              Decommission Mode
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Tap a row to retire it. Changes save immediately.
            </p>
          </div>
        </div>
      </header>

      {schemaError && (
        <div role="alert" className="rounded-xl border-2 border-rose-300 bg-rose-50 dark:bg-rose-950/40 p-4 text-sm text-rose-900 dark:text-rose-100 space-y-2">
          <p className="font-bold flex items-center gap-2">
            <span>⚠</span> Database schema is out of date
          </p>
          <p>
            The <code className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 font-mono text-xs">decommissioned</code> column
            isn&apos;t being returned for any equipment row. Decommission writes will not persist until this is fixed.
          </p>
          <p className="text-xs">
            Open the Supabase SQL editor and run{' '}
            <code className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 font-mono">migrations/002_decommissioned_and_indexes.sql</code>,
            then reload PostgREST&apos;s schema cache with{' '}
            <code className="px-1 py-0.5 rounded bg-rose-100 dark:bg-rose-900/40 font-mono">NOTIFY pgrst, &apos;reload schema&apos;;</code>
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
          bgClass="bg-amber-50 dark:bg-amber-950/40"
        />
        <CounterTile
          value={equipment.length}
          label="Total"
          valueClass="text-slate-500 dark:text-slate-400"
          bgClass="bg-muted/40"
        />
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="search"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search equipment"
          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy transition-colors"
        />
      </div>

      {/* List */}
      {grouped.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-slate-400 dark:text-slate-500 text-sm">
          {equipment.length === 0
            ? 'No equipment to show.'
            : `No equipment matches "${debounced.trim()}".`}
        </div>
      ) : (
        <div className="rounded-xl bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
          {grouped.map((group, gi) => (
            <section key={group.dept}>
              <div className={`sticky top-0 z-10 bg-slate-50/95 dark:bg-slate-900/40/95 backdrop-blur px-4 py-2 flex items-center justify-between ${gi > 0 ? 'border-t border-slate-200 dark:border-slate-700' : ''}`}>
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {group.dept}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {group.decommCount}/{group.rows.length} decommissioned
                </span>
              </div>
              <ul>
                {group.rows.map(eq => (
                  <li key={eq.equipment_id} className="border-t border-slate-100 dark:border-slate-800 first:border-t-0">
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
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 dark:bg-slate-900/10 text-white text-sm font-bold disabled:opacity-50 hover:bg-white/20 dark:hover:bg-slate-900/20 transition-colors min-h-[40px]"
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
