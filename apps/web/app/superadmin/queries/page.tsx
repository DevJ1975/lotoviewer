'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, FileCode2, Play, Save, Plus, Trash2,
  CheckCircle2, RefreshCw, Pencil,
} from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import type { SavedQueryRow } from '@/app/api/superadmin/queries/route'
import type { RunResponse }   from '@/app/api/superadmin/queries/run/route'

// Saved queries page. Three areas:
//   1. Left rail — list of saved queries; click to load into editor.
//   2. Editor — name + description + SQL textarea + Run / Save / Delete.
//   3. Results — table of the last run.
//
// "New" wipes the editor; "Save" creates or updates depending on
// whether `selectedId` is set. The endpoint enforces the SELECT-only
// rule; the UI surfaces any error verbatim.

const SAMPLE_SQL = `-- Read-only SELECT, WITH, or EXPLAIN. Hard cap 5000 rows + 10s.
select tenant_number, name, status, created_at
  from public.tenants
 order by created_at desc
 limit 25;`

interface DraftState {
  id:          number | null
  name:        string
  description: string
  sql:         string
}

const EMPTY_DRAFT: DraftState = { id: null, name: '', description: '', sql: SAMPLE_SQL }

export default function SavedQueriesPage() {
  const [list,    setList]    = useState<SavedQueryRow[] | null>(null)
  const [draft,   setDraft]   = useState<DraftState>(EMPTY_DRAFT)
  const [run,     setRun]     = useState<RunResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  // Tracks the original strings of the loaded query so the UI can
  // surface "unsaved changes" + warn before a navigation that would
  // drop them. Compared by value — the textarea always rerenders.
  const [baseline, setBaseline] = useState<{ name: string; description: string; sql: string }>(
    { name: EMPTY_DRAFT.name, description: EMPTY_DRAFT.description, sql: EMPTY_DRAFT.sql }
  )
  const dirty =
    draft.name        !== baseline.name        ||
    draft.description !== baseline.description ||
    draft.sql         !== baseline.sql

  // Auto-fade the "Saved" indicator after 2.5s so it doesn't linger.
  useEffect(() => {
    if (savedAt == null) return
    const t = setTimeout(() => setSavedAt(null), 2500)
    return () => clearTimeout(t)
  }, [savedAt])

  // beforeunload guard — only fires for full reloads / tab close. SPA
  // navigation inside the app is rarer here (the page is leaf-level).
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const loadList = useCallback(async () => {
    setLoading(true); setError(null)
    const r = await superadminJson<{ queries: SavedQueryRow[] }>('/api/superadmin/queries', { method: 'GET' })
    if (r.ok && r.body) setList(r.body.queries)
    else                setError(r.error ?? 'Failed to load saved queries')
    setLoading(false)
  }, [])

  useEffect(() => { void loadList() }, [loadList])

  function selectQuery(q: SavedQueryRow) {
    if (dirty && !confirm('You have unsaved changes. Discard them and load this query?')) return
    const next = { id: q.id, name: q.name, description: q.description ?? '', sql: q.sql_text }
    setDraft(next)
    setBaseline({ name: next.name, description: next.description, sql: next.sql })
    setRun(null)
    setError(null)
    setSavedAt(null)
  }

  function newDraft() {
    if (dirty && !confirm('You have unsaved changes. Discard them and start a new query?')) return
    setDraft(EMPTY_DRAFT)
    setBaseline({ name: EMPTY_DRAFT.name, description: EMPTY_DRAFT.description, sql: EMPTY_DRAFT.sql })
    setRun(null)
    setError(null)
    setSavedAt(null)
  }

  async function runDraft() {
    setBusy(true); setError(null); setSavedAt(null)
    const r = await superadminJson<RunResponse>('/api/superadmin/queries/run', {
      method: 'POST',
      body:   JSON.stringify({ sql: draft.sql }),
    })
    if (r.ok && r.body) {
      setRun(r.body)
    } else {
      setError(r.error ?? 'Run failed')
      setRun(null)
    }
    setBusy(false)
  }

  async function saveDraft() {
    if (draft.name.trim().length === 0) {
      setError('Name is required to save')
      return
    }
    setBusy(true); setError(null); setSavedAt(null)
    const isUpdate = draft.id != null
    const url      = isUpdate ? `/api/superadmin/queries/${draft.id}` : '/api/superadmin/queries'
    const method   = isUpdate ? 'PATCH' : 'POST'
    const r = await superadminJson<{ query: SavedQueryRow }>(url, {
      method,
      body: JSON.stringify({
        name:        draft.name.trim(),
        description: draft.description.trim() || null,
        sql_text:    draft.sql,
      }),
    })
    if (r.ok && r.body) {
      const next = {
        id:          r.body.query.id,
        name:        r.body.query.name,
        description: r.body.query.description ?? '',
        sql:         r.body.query.sql_text,
      }
      setDraft(next)
      setBaseline({ name: next.name, description: next.description, sql: next.sql })
      setSavedAt(Date.now())
      void loadList()
    } else {
      setError(r.error ?? 'Save failed')
    }
    setBusy(false)
  }

  async function deleteDraft() {
    if (draft.id == null) return
    if (!confirm(`Delete saved query "${draft.name}"? This cannot be undone.`)) return
    setBusy(true); setError(null)
    const r = await superadminJson(`/api/superadmin/queries/${draft.id}`, { method: 'DELETE' })
    if (r.ok) {
      newDraft()
      void loadList()
    } else {
      setError(r.error ?? 'Delete failed')
    }
    setBusy(false)
  }

  const columns = useMemo(() => {
    if (!run || run.rows.length === 0) return [] as string[]
    return Object.keys(run.rows[0])
  }, [run])

  // Re-render-stable ref so the keydown handler always runs the latest
  // draft. Without this, the handler closes over the original empty
  // state and re-running after edits sends nothing.
  const runRef = useRef(runDraft)
  runRef.current = runDraft

  function onSqlKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Cmd+Enter (mac) / Ctrl+Enter (win/linux) — runs the current SQL.
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void runRef.current()
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <header className="flex items-start gap-3 mb-6">
        <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <FileCode2 className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
            Saved queries
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2 max-w-3xl">
            Read-only SQL across every tenant. SELECT, WITH, and EXPLAIN only;
            statement timeout 10s; result cap 5000 rows. Edit in the editor and
            run — saved queries are reusable diagnostics shared across all
            superadmins.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-5">
        {/* Left rail */}
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[11px] uppercase tracking-widest text-slate-500 dark:text-slate-400 font-semibold">Saved</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Refresh"
                onClick={() => void loadList()}
                disabled={loading}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
              >
                <RefreshCw className={loading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
              </button>
              <button
                type="button"
                onClick={newDraft}
                className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
                aria-label="New query"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {loading && !list ? (
            <div className="py-8 flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          ) : list && list.length === 0 ? (
            <p className="text-xs text-slate-400 dark:text-slate-500 italic px-2 py-4">
              No saved queries yet. Write one in the editor and click Save.
            </p>
          ) : (
            <ul className="space-y-1">
              {(list ?? []).map(q => {
                const active = q.id === draft.id
                return (
                  <li key={q.id}>
                    <button
                      type="button"
                      onClick={() => selectQuery(q)}
                      className={`w-full text-left px-2.5 py-2 rounded-md text-sm transition-colors ${
                        active
                          ? 'bg-brand-navy/10 dark:bg-brand-yellow/10 text-brand-navy dark:text-brand-yellow font-medium'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <div className="font-mono text-xs truncate" title={q.name}>{q.name}</div>
                      {q.description && (
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate" title={q.description}>
                          {q.description}
                        </div>
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        {/* Editor + results */}
        <section className="space-y-4 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Name {draft.id != null && <span className="text-[10px] opacity-60">(editing #{draft.id})</span>}
              </span>
              <input
                type="text"
                value={draft.name}
                onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
                placeholder="recent-tenant-signups"
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
              <input
                type="text"
                value={draft.description}
                onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                placeholder="Last 25 tenants by created_at"
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
          </div>

          <div className="relative">
            <textarea
              value={draft.sql}
              onChange={e => setDraft(d => ({ ...d, sql: e.target.value }))}
              onKeyDown={onSqlKeyDown}
              spellCheck={false}
              rows={14}
              aria-label="SQL editor"
              placeholder="SELECT ... FROM ..."
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
            <kbd className="pointer-events-none absolute bottom-2 right-3 text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-100/80 dark:bg-slate-800/80 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
              ⌘ ⏎ to run
            </kbd>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={runDraft}
              disabled={busy || draft.sql.trim().length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 transition-colors"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Run
            </button>
            <button
              type="button"
              onClick={saveDraft}
              disabled={busy || draft.name.trim().length === 0}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-60 transition-colors"
            >
              {draft.id != null ? <Pencil className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {draft.id != null ? 'Update' : 'Save'}
            </button>
            {draft.id != null && (
              <button
                type="button"
                onClick={deleteDraft}
                disabled={busy}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 text-sm font-medium hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-60 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
            {savedAt != null && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 transition-opacity">
                <CheckCircle2 className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            {dirty && savedAt == null && draft.id != null && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400" title="Unsaved changes">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Unsaved changes
              </span>
            )}
          </div>

          {error && (
            <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
              <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
              <pre className="text-xs text-rose-800 dark:text-rose-200 whitespace-pre-wrap font-mono">{error}</pre>
            </div>
          )}

          {run && (
            <ResultsTable run={run} columns={columns} draftName={draft.name} />
          )}
        </section>
      </div>
    </div>
  )
}

function formatCell(v: unknown): string {
  if (v == null)             return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try { return JSON.stringify(v) }
  catch { return String(v) }
}

function ResultsTable({
  run, columns, draftName,
}: { run: RunResponse; columns: string[]; draftName: string }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  function downloadCsv() {
    if (run.rows.length === 0) return
    const escape = (v: unknown): string => {
      const s = formatCell(v)
      if (s === '') return ''
      // Quote if contains comma, quote, newline, or carriage return.
      if (/[,"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const header = columns.join(',')
    const body   = run.rows.map(r => columns.map(c => escape(r[c])).join(',')).join('\n')
    const csv    = `${header}\n${body}\n`
    const blob   = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url    = URL.createObjectURL(blob)
    const stem   = (draftName.trim() || 'query').replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()
    const a = document.createElement('a')
    a.href = url
    a.download = `${stem}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
      <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-2">
        <span>
          {run.rowCount.toLocaleString()} row{run.rowCount === 1 ? '' : 's'}
          {run.truncated && <span className="text-amber-600 dark:text-amber-400"> (truncated at {run.maxRows.toLocaleString()})</span>}
        </span>
        <span className="flex items-center gap-3">
          <span className="font-mono">{run.durationMs} ms</span>
          {run.rows.length > 0 && (
            <button
              type="button"
              onClick={downloadCsv}
              className="text-[11px] underline hover:no-underline text-slate-600 dark:text-slate-300 normal-case tracking-normal"
            >
              Download CSV
            </button>
          )}
        </span>
      </div>
      {run.rows.length === 0 ? (
        <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">No rows.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900/40 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
              <tr>
                {columns.map(c => <th key={c} className="text-left px-3 py-2 whitespace-nowrap">{c}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {run.rows.map((row, i) => {
                const open = expandedRow === i
                return (
                  <tr
                    key={i}
                    onClick={() => setExpandedRow(open ? null : i)}
                    className={`cursor-pointer ${open ? 'bg-slate-50 dark:bg-slate-900/40' : 'hover:bg-slate-50/60 dark:hover:bg-slate-700/30'}`}
                  >
                    {columns.map(c => (
                      <td key={c} className="px-3 py-2 align-top text-slate-700 dark:text-slate-200 font-mono max-w-[420px]">
                        {open ? (
                          <div className="whitespace-pre-wrap break-words">{formatCell(row[c])}</div>
                        ) : (
                          <div className="truncate" title={formatCell(row[c])}>{formatCell(row[c])}</div>
                        )}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
