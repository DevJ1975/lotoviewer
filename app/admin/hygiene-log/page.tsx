'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, Loader2, Search, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type { HygieneAction, HygieneLogRow } from '@/lib/types'

// Hygiene-log viewer. Surfaces rows from loto_hygiene_log — populated
// by one-off data-hygiene scripts run in the Supabase SQL Editor (e.g.
// migrations/data_hygiene_snak_king_2026-04-27.sql).
//
// Why we have a separate viewer (rather than just /admin/audit):
// audit_log captures every row change via triggers — useful but noisy.
// loto_hygiene_log captures the higher-level "what op did we run, why."
// One row per business decision, not one per column edit.

const PAGE_SIZE = 500   // hygiene runs produce hundreds of rows at most

const ACTION_STYLE: Record<HygieneAction, string> = {
  decommission:    'bg-rose-50    text-rose-800    ring-rose-200',
  rename:          'bg-blue-50    text-blue-800    ring-blue-200',
  note_append:     'bg-slate-50   text-slate-700   ring-slate-200',
  fk_repair:       'bg-amber-50   text-amber-800   ring-amber-200',
  orphan_detected: 'bg-rose-100   text-rose-900    ring-rose-300 font-bold',
  snapshot:        'bg-emerald-50 text-emerald-800 ring-emerald-200',
  error:           'bg-rose-200   text-rose-900    ring-rose-400 font-bold',
}

const ALL_ACTIONS: HygieneAction[] = [
  'decommission', 'rename', 'note_append',
  'fk_repair', 'orphan_detected', 'snapshot', 'error',
]

type DateScope = 'today' | '7d' | '30d' | 'all'

const DATE_SCOPE_LABEL: Record<DateScope, string> = {
  today: 'Today',
  '7d':  'Last 7 days',
  '30d': 'Last 30 days',
  all:   'All time',
}

export default function HygieneLogPage() {
  const { profile, loading: authLoading } = useAuth()
  const [rows, setRows]                 = useState<HygieneLogRow[]>([])
  const [loading, setLoading]           = useState(true)
  const [loadError, setLoadError]       = useState<string | null>(null)
  const [search, setSearch]             = useState('')
  const [sectionFilter, setSectionFilter] = useState<string>('')
  const [actionFilter, setActionFilter]   = useState<'' | HygieneAction>('')
  const [dateScope, setDateScope]       = useState<DateScope>('today')
  const [expandedId, setExpandedId]     = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    let q = supabase
      .from('loto_hygiene_log')
      .select('*')
      .order('ran_at', { ascending: false })
      .limit(PAGE_SIZE)

    // Server-side date scope. For "all" we skip the gte filter entirely
    // so the index on (section, ran_at desc) still helps but we don't
    // box ourselves out of historical rows.
    const cutoff = scopeCutoffIso(dateScope)
    if (cutoff) q = q.gte('ran_at', cutoff)

    const { data, error } = await q
    if (error) {
      setLoadError(error.message)
      setRows([])
    } else {
      setRows((data ?? []) as HygieneLogRow[])
    }
    setLoading(false)
  }, [dateScope])

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    fetchRows()
  }, [authLoading, profile, fetchRows])

  // Distinct section list for the dropdown — derived from current page
  // of rows, not a separate roundtrip. With PAGE_SIZE=500 this captures
  // every section in any realistic week of hygiene activity.
  const sections = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) set.add(r.section)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [rows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (sectionFilter && r.section !== sectionFilter) return false
      if (actionFilter  && r.action  !== actionFilter)  return false
      if (q) {
        return (
             r.equipment_id?.toLowerCase().includes(q)
          || r.reason.toLowerCase().includes(q)
          || r.section.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [rows, search, sectionFilter, actionFilter])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Wrench className="h-5 w-5 text-slate-500" />
            Data Hygiene Log
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            One-off LOTO data-hygiene operations — decommissions, renames, FK repairs, batch note appends.
          </p>
        </div>
      </header>

      {/* Filters + export */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => downloadHygieneCsv(filtered)}
          disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Export {filtered.length} row{filtered.length === 1 ? '' : 's'} (CSV)
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto] gap-3">
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by equipment_id, reason, or section…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </div>
        <select
          value={sectionFilter}
          onChange={e => setSectionFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="">All sections</option>
          {sections.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value as '' | HygieneAction)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="">All actions</option>
          {ALL_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          value={dateScope}
          onChange={e => setDateScope(e.target.value as DateScope)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          {(['today','7d','30d','all'] as DateScope[]).map(s => (
            <option key={s} value={s}>{DATE_SCOPE_LABEL[s]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <section className="bg-white rounded-xl ring-1 ring-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : loadError ? (
          <div className="px-5 py-6 space-y-1">
            <p className="text-sm font-semibold text-rose-700">{loadError}</p>
            <p className="text-xs text-slate-500">
              If this says <span className="font-mono">relation &quot;loto_hygiene_log&quot; does not exist</span>, run the
              data-hygiene SQL script first — the table is created in Section -1.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500 text-center">
            {rows.length === 0
              ? 'No hygiene operations logged yet.'
              : 'No rows match your filters.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map(r => {
              const isOpen = expandedId === r.id
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isOpen ? null : r.id)}
                    className="w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center gap-3"
                    aria-expanded={isOpen}
                  >
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ring-1 shrink-0 tracking-wider ${ACTION_STYLE[r.action]}`}>
                      {r.action}
                    </span>
                    <span className="font-mono text-xs text-slate-700 truncate min-w-0 max-w-[200px] shrink-0">
                      {r.section}
                    </span>
                    <span className="font-mono text-xs text-slate-500 truncate flex-1 min-w-0">
                      {r.equipment_id ?? <span className="italic text-slate-400">—</span>}
                    </span>
                    <span className="hidden md:inline text-xs text-slate-500 truncate max-w-[400px] shrink-0">
                      {r.reason}
                    </span>
                    <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                      {new Date(r.ran_at).toLocaleString()}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3 bg-slate-50/40 border-t border-slate-100">
                      <DetailField label="Reason">
                        <p className="text-xs text-slate-700">{r.reason}</p>
                      </DetailField>
                      <DetailField label="Detail">
                        {r.detail
                          ? <pre className="text-[11px] font-mono text-slate-700 bg-white rounded-md p-3 ring-1 ring-slate-200 overflow-auto max-h-72">{JSON.stringify(r.detail, null, 2)}</pre>
                          : <p className="text-xs text-slate-400 italic">none</p>}
                      </DetailField>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
      {children}
    </div>
  )
}

function scopeCutoffIso(scope: DateScope): string | null {
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000
  switch (scope) {
    case 'today': return new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z').toISOString()
    case '7d':    return new Date(now - 7  * day).toISOString()
    case '30d':   return new Date(now - 30 * day).toISOString()
    case 'all':   return null
  }
}

// CSV export — same shape as /admin/audit. Hygiene logs are routinely
// pulled into compliance binders for OSHA inspections and §147 annual
// audits, so handing the safety committee a clean spreadsheet matters.
function downloadHygieneCsv(rows: HygieneLogRow[]): void {
  const header = ['ran_at','section','equipment_id','action','reason','detail']
  const escape = (val: unknown): string => {
    const s = val == null ? '' : typeof val === 'string' ? val : JSON.stringify(val)
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [
    header.join(','),
    ...rows.map(r => [
      r.ran_at, r.section, r.equipment_id ?? '', r.action, r.reason, r.detail,
    ].map(escape).join(',')),
  ]
  const csv = lines.join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const a = document.createElement('a')
  a.href     = url
  a.download = `hygiene-log-${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
