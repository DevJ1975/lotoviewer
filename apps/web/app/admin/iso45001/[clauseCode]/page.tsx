'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookText, Download, Loader2, Trash2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import { findClause } from '@soteria/core/iso45001'

// /admin/iso45001/[clauseCode] — evidence pack for a single clause.
//
// Lists every pinned evidence row plus a date filter so an auditor
// preparing for an audit window can narrow down to "everything
// pinned in the last 90 days". Export-evidence-pack renders a PDF
// summary via the existing pdf-lib pipeline.

interface EvidenceRow {
  id:                  string
  clause_code:         string
  source_table:        string
  source_id:           string
  captured_at:         string
  captured_by_user_id: string | null
  notes:               string | null
}

export default function ClauseDetailPage({ params }: { params: Promise<{ clauseCode: string }> }) {
  const { clauseCode } = use(params)
  const decoded = decodeURIComponent(clauseCode)
  const clause  = findClause(decoded)

  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [rows,  setRows]        = useState<EvidenceRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [from,  setFrom]        = useState<string>('')
  const [to,    setTo]          = useState<string>('')
  const [exporting, setExporting] = useState(false)

  // New-pin form.
  const [newSourceTable, setNewSourceTable] = useState('')
  const [newSourceId,    setNewSourceId]    = useState('')
  const [newNotes,       setNewNotes]       = useState('')
  const [saving,         setSaving]         = useState(false)

  const load = useCallback(async () => {
    if (!tenantId || !clause) return
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('iso45001_clause_evidence')
        .select('id, clause_code, source_table, source_id, captured_at, captured_by_user_id, notes')
        .eq('tenant_id', tenantId)
        .eq('clause_code', clause.code)
        .order('captured_at', { ascending: false })
        .limit(500)
      if (error) throw new Error(formatSupabaseError(error, 'load evidence'))
      setRows((data ?? []) as EvidenceRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load evidence.')
    }
  }, [tenantId, clause])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  const filtered = useMemo(() => {
    if (!rows) return [] as EvidenceRow[]
    const fromMs = from ? Date.parse(`${from}T00:00:00Z`) : Number.NEGATIVE_INFINITY
    const toMs   = to   ? Date.parse(`${to}T23:59:59.999Z`) : Number.POSITIVE_INFINITY
    return rows.filter(r => {
      const t = Date.parse(r.captured_at)
      return Number.isFinite(t) && t >= fromMs && t <= toMs
    })
  }, [rows, from, to])

  async function pinEvidence() {
    if (!tenantId || !clause || !newSourceTable.trim() || !newSourceId.trim()) return
    setSaving(true)
    setLoadError(null)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase
        .from('iso45001_clause_evidence')
        .upsert({
          tenant_id:           tenantId,
          clause_code:         clause.code,
          source_table:        newSourceTable.trim(),
          source_id:           newSourceId.trim(),
          notes:               newNotes.trim() || null,
          captured_by_user_id: user?.id ?? null,
        }, { onConflict: 'tenant_id,clause_code,source_table,source_id' })
      if (error) throw new Error(formatSupabaseError(error, 'pin evidence'))
      setNewSourceTable(''); setNewSourceId(''); setNewNotes('')
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not pin evidence.')
    } finally {
      setSaving(false)
    }
  }

  async function unpin(id: string) {
    if (!tenantId) return
    if (!confirm('Remove this evidence pin?')) return
    setSaving(true)
    setLoadError(null)
    try {
      const { error } = await supabase
        .from('iso45001_clause_evidence')
        .delete()
        .eq('id', id)
        .eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'remove pin'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not remove pin.')
    } finally {
      setSaving(false)
    }
  }

  async function exportEvidence() {
    if (filtered.length === 0 || !clause) return
    setExporting(true)
    try {
      const { generateIso45001EvidencePack } = await import('@/lib/pdfIso45001Evidence')
      const bytes = await generateIso45001EvidencePack({
        clause,
        rows: filtered,
        from,
        to,
      })
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `iso45001-${clause.code}-evidence.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not export evidence pack.')
    } finally {
      setExporting(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }
  if (!clause) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 space-y-3">
        <Link href="/admin/iso45001" className="inline-flex items-center gap-1 text-xs text-slate-500">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <p className="text-sm text-rose-700">Unknown clause code: {decoded}</p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/admin/iso45001" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to clause map
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <BookText className="h-6 w-6 text-brand-navy" />
          ISO 45001 · {clause.code} {clause.title}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Modules contributing evidence: <span className="font-mono">{clause.sources.join(', ')}</span>
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Pin new evidence
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Source table</span>
            <input
              type="text"
              value={newSourceTable}
              onChange={e => setNewSourceTable(e.target.value)}
              placeholder="e.g. incidents"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Source ID</span>
            <input
              type="text"
              value={newSourceId}
              onChange={e => setNewSourceId(e.target.value)}
              placeholder="row id"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Notes (optional)</span>
            <input
              type="text"
              value={newNotes}
              onChange={e => setNewNotes(e.target.value)}
              placeholder="why this row demonstrates the clause"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm"
            />
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void pinEvidence()}
            disabled={saving || !newSourceTable.trim() || !newSourceId.trim()}
            className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
          >
            {saving ? 'Saving…' : 'Pin evidence'}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Pinned evidence ({filtered.length} / {rows?.length ?? 0})
          </h2>
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <label className="flex items-center gap-1">
              From
              <input
                type="date"
                value={from}
                onChange={e => setFrom(e.target.value)}
                max={to || undefined}
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
              />
            </label>
            <label className="flex items-center gap-1">
              To
              <input
                type="date"
                value={to}
                onChange={e => setTo(e.target.value)}
                min={from || undefined}
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
              />
            </label>
            <button
              type="button"
              onClick={() => void exportEvidence()}
              disabled={exporting || filtered.length === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
            >
              {exporting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
              Export evidence pack
            </button>
          </div>
        </header>

        {rows === null ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            No pinned evidence in this window. Pin a row above to start the trail.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {filtered.map(row => (
              <li key={row.id} className="py-2 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-slate-900 dark:text-slate-100">
                      {row.source_table}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      {row.source_id}
                    </span>
                    <span className="ml-auto text-[10px] text-slate-400 tabular-nums">
                      {new Date(row.captured_at).toLocaleDateString()}
                    </span>
                  </div>
                  {row.notes && (
                    <p className="text-xs text-slate-600 dark:text-slate-400 italic mt-0.5">{row.notes}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void unpin(row.id)}
                  disabled={saving}
                  className="shrink-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-md p-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
