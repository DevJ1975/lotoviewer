'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, History, Loader2, Search } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'

interface AuditRow {
  id:           number
  actor_id:     string | null
  actor_email:  string | null
  table_name:   string
  operation:    'INSERT' | 'UPDATE' | 'DELETE'
  row_pk:       string | null
  old_row:      Record<string, unknown> | null
  new_row:      Record<string, unknown> | null
  created_at:   string
}

const OP_STYLE: Record<AuditRow['operation'], string> = {
  INSERT: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  UPDATE: 'bg-blue-50 text-blue-700 ring-blue-200',
  DELETE: 'bg-rose-50 text-rose-700 ring-rose-200',
}

const PAGE_SIZE = 100

export default function AuditLogPage() {
  const { profile, loading: authLoading } = useAuth()
  const [rows, setRows]               = useState<AuditRow[]>([])
  const [loading, setLoading]         = useState(true)
  const [loadError, setLoadError]     = useState<string | null>(null)
  const [tableFilter, setTableFilter] = useState<string>('')
  const [opFilter, setOpFilter]       = useState<'' | 'INSERT' | 'UPDATE' | 'DELETE'>('')
  const [search, setSearch]           = useState('')
  const [expandedId, setExpandedId]   = useState<number | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    let q = supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (tableFilter) q = q.eq('table_name', tableFilter)
    if (opFilter)    q = q.eq('operation', opFilter)
    const { data, error } = await q
    if (error) {
      setLoadError(error.message)
      setRows([])
    } else {
      setRows((data ?? []) as AuditRow[])
    }
    setLoading(false)
  }, [tableFilter, opFilter])

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    fetchRows()
  }, [authLoading, profile, fetchRows])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(r =>
      r.actor_email?.toLowerCase().includes(q)
      || r.row_pk?.toLowerCase().includes(q)
      || r.table_name.toLowerCase().includes(q),
    )
  }, [rows, search])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-brand-navy" aria-label="Back to dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <History className="h-5 w-5 text-slate-500" />
            Audit Log
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Most recent {PAGE_SIZE} CRUD operations across audited tables.
          </p>
        </div>
      </header>

      {/* Filters */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3">
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter by actor, row id, or table…"
            className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </div>
        <select
          value={tableFilter}
          onChange={e => setTableFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="">All tables</option>
          <option value="loto_equipment">loto_equipment</option>
          <option value="loto_energy_steps">loto_energy_steps</option>
          <option value="loto_reviews">loto_reviews</option>
          <option value="profiles">profiles</option>
        </select>
        <select
          value={opFilter}
          onChange={e => setOpFilter(e.target.value as '' | 'INSERT' | 'UPDATE' | 'DELETE')}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="">All operations</option>
          <option value="INSERT">INSERT</option>
          <option value="UPDATE">UPDATE</option>
          <option value="DELETE">DELETE</option>
        </select>
      </div>

      {/* Table */}
      <section className="bg-white rounded-xl ring-1 ring-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : loadError ? (
          <p className="px-5 py-6 text-sm text-rose-700">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="px-5 py-10 text-sm text-slate-500 text-center">No audit entries match.</p>
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
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ring-1 shrink-0 tracking-wider ${OP_STYLE[r.operation]}`}>
                      {r.operation}
                    </span>
                    <span className="font-mono text-xs text-slate-700 truncate min-w-0 max-w-[140px] shrink-0">
                      {r.table_name}
                    </span>
                    <span className="font-mono text-xs text-slate-500 truncate flex-1 min-w-0">
                      {r.row_pk ?? '—'}
                    </span>
                    <span className="hidden sm:inline text-xs text-slate-500 truncate max-w-[180px] shrink-0">
                      {r.actor_email ?? <span className="italic text-slate-400">system</span>}
                    </span>
                    <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap shrink-0">
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 space-y-3 bg-slate-50/40 border-t border-slate-100">
                      <DiffBlock label="Before" value={r.old_row} />
                      <DiffBlock label="After"  value={r.new_row} />
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

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) {
    return (
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
        <p className="text-xs text-slate-400 italic">none</p>
      </div>
    )
  }
  return (
    <div>
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">{label}</p>
      <pre className="text-[11px] font-mono text-slate-700 bg-white rounded-md p-3 ring-1 ring-slate-200 overflow-auto max-h-72">
{JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
