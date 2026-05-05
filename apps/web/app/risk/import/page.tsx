'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  parseRiskCsv,
  toApiPayload,
  RISK_CSV_REQUIRED,
  type ParsedRiskRow,
} from '@/lib/csvImportRisk'

// /risk/import — admin-only CSV bulk import for the risk register.
// Two stages:
//   1. Parse + validate the CSV client-side. Surface every row with
//      its status (valid / invalid + error message). User can see
//      what'll get imported before any DB write.
//   2. Import — POSTs each valid row individually to /api/risk so
//      the existing audit trigger + PPE-alone constraint fire per
//      row. Concurrency limited to 4 to be polite to the DB +
//      avoid blowing past the constraint trigger's lock budget.

const TEMPLATE_CSV = [
  RISK_CSV_REQUIRED.join(','),
  'Forklift collision near loading dock,Operator turning corner without spotter,physical,inspection,routine,daily,4,3',
  'Slip on wet floor,Spilled cleaning solution near packaging line,physical,worker_report,routine,weekly,2,3',
].join('\n')

interface ImportResult {
  rowNumber: number
  ok:        boolean
  message?:  string
}

export default function RiskCsvImportPage() {
  const { tenant } = useTenant()
  const { profile, loading: authLoading } = useAuth()
  const canImport = !!profile?.is_admin || !!profile?.is_superadmin

  const [rows,   setRows]   = useState<ParsedRiskRow[]>([])
  const [headerError, setHeaderError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState<ImportResult[]>([])
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!canImport) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    const { rows, headerError } = parseRiskCsv(text)
    setRows(rows)
    setHeaderError(headerError)
    setResults([])
  }

  function downloadTemplate() {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'risk-register-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function runImport() {
    if (!tenant?.id) return
    const valid = rows.filter(r => r.status === 'valid')
    if (valid.length === 0) return
    setImporting(true)
    setResults([])
    setProgress({ done: 0, total: valid.length })

    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant.id,
    }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

    // Sequential with a small concurrency window. Per-row POST keeps
    // the audit trigger + per-tenant sequence happy.
    const CONCURRENCY = 4
    const queue = valid.slice()
    const collected: ImportResult[] = []
    async function worker() {
      while (queue.length > 0) {
        const row = queue.shift()
        if (!row) break
        try {
          const res = await fetch('/api/risk', {
            method: 'POST',
            headers,
            body: JSON.stringify(toApiPayload(row)),
          })
          const body = await res.json()
          if (!res.ok) collected.push({ rowNumber: row.rowNumber, ok: false, message: body.error ?? `HTTP ${res.status}` })
          else         collected.push({ rowNumber: row.rowNumber, ok: true })
        } catch (e) {
          collected.push({ rowNumber: row.rowNumber, ok: false, message: e instanceof Error ? e.message : String(e) })
        } finally {
          setProgress(p => p ? { done: p.done + 1, total: p.total } : null)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    setResults(collected.sort((a, b) => a.rowNumber - b.rowNumber))
    setImporting(false)
  }

  const validCount   = rows.filter(r => r.status === 'valid').length
  const invalidCount = rows.filter(r => r.status === 'invalid').length
  const successes    = results.filter(r => r.ok).length
  const failures     = results.filter(r => !r.ok).length

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link
        href="/risk/list"
        className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to register
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Bulk import risks</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Upload a CSV with one risk per row. Every row goes through the same validation
          + audit log as a wizard-created risk.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold cursor-pointer hover:bg-brand-navy/90">
              <Upload className="h-4 w-4" />
              Choose CSV
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
            </label>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <FileText className="h-4 w-4" />
              Download template
            </button>
          </div>
          {rows.length > 0 && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {validCount} valid · {invalidCount} invalid
            </div>
          )}
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Required columns: {RISK_CSV_REQUIRED.join(', ')}.
          Optional: location, process, residual_severity, residual_likelihood,
          ppe_only_justification, next_review_date (YYYY-MM-DD).
        </p>
      </section>

      {headerError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{headerError}</span>
        </div>
      )}

      {rows.length > 0 && (
        <section className="space-y-3">
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Preview</h2>
            <button
              type="button"
              onClick={runImport}
              disabled={validCount === 0 || importing}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {importing && <Loader2 className="h-4 w-4 animate-spin" />}
              Import {validCount} {validCount === 1 ? 'row' : 'rows'}
            </button>
          </header>

          {progress && (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {progress.done} / {progress.total} processed
              {results.length > 0 && (
                <> — <span className="text-emerald-600">{successes} OK</span> ·{' '}
                  <span className="text-rose-600">{failures} failed</span></>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-xs">
              <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Row</th>
                  <th className="px-3 py-2 text-left">Title</th>
                  <th className="px-3 py-2 text-left">Category</th>
                  <th className="px-3 py-2 text-left">Inherent</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                {rows.map(r => {
                  const result = results.find(x => x.rowNumber === r.rowNumber)
                  return (
                    <tr key={r.rowNumber}>
                      <td className="px-3 py-1.5 font-mono text-slate-500 tabular-nums">{r.rowNumber}</td>
                      <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300 max-w-md truncate">{r.title || '—'}</td>
                      <td className="px-3 py-1.5 capitalize text-slate-600 dark:text-slate-400">{r.hazard_category || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-600 dark:text-slate-400">
                        {r.inherent_severity}×{r.inherent_likelihood}
                      </td>
                      <td className="px-3 py-1.5">
                        {result?.ok && (
                          <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Imported</span>
                        )}
                        {result && !result.ok && (
                          <span className="inline-flex items-center gap-1 text-rose-700" title={result.message}><AlertTriangle className="h-3 w-3" /> {result.message?.slice(0, 60) ?? 'Failed'}</span>
                        )}
                        {!result && r.status === 'valid' && (
                          <span className="inline-flex items-center gap-1 text-slate-500"><CheckCircle2 className="h-3 w-3" /> Valid</span>
                        )}
                        {!result && r.status === 'invalid' && (
                          <span className="inline-flex items-center gap-1 text-amber-700" title={r.error}><AlertTriangle className="h-3 w-3" /> {r.error?.slice(0, 60) ?? 'Invalid'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
