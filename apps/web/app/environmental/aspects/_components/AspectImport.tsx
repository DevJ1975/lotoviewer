'use client'

import { useState } from 'react'
import { decodeFile } from '@/lib/csvImport'
import { createAspect, scoreAspect } from '@/lib/environmental/client'
import {
  ASPECT_CSV_TEMPLATE,
  aspectBody,
  parseAspectCsv,
  type ParsedAspectRow,
} from '@/lib/environmental/csvImportAspects'
import { BUTTON_PRIMARY, BUTTON_SECONDARY, FIELD_ERROR } from '../../_components/formStyles'

// Bulk-load aspects from a CSV, following the risk importer: parse and check
// every row in the browser first, then send the valid ones one at a time
// through the same API a hand-typed aspect uses, so validation, RLS and the
// audit trail apply to each row. The active facility receives them all.

type Outcome = { rowNumber: number; ok: true } | { rowNumber: number; ok: false; error: string }

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([ASPECT_CSV_TEMPLATE], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'aspects-template.csv'
  link.click()
  URL.revokeObjectURL(url)
}

export function AspectImport({ tenantId, onImported, onClose }: {
  tenantId: string; onImported: () => void; onClose: () => void
}) {
  const [rows, setRows] = useState<ParsedAspectRow[] | null>(null)
  const [headerError, setHeaderError] = useState<string | null>(null)
  const [outcomes, setOutcomes] = useState<Outcome[]>([])
  const [running, setRunning] = useState(false)

  async function choose(file: File | undefined) {
    setOutcomes([])
    if (!file) return
    const parsed = parseAspectCsv(await decodeFile(file))
    setHeaderError(parsed.headerError)
    setRows(parsed.rows)
  }

  async function run() {
    if (!rows) return
    setRunning(true)
    const results: Outcome[] = []
    for (const row of rows.filter(r => r.status === 'valid')) {
      try {
        const { aspect } = await createAspect(tenantId, aspectBody(row.aspect))
        if (row.score) {
          await scoreAspect(tenantId, aspect.id, {
            operating_condition: row.score.operatingCondition,
            severity:            row.score.severity,
            likelihood:          row.score.likelihood,
            rationale:           row.score.rationale,
          })
        }
        results.push({ rowNumber: row.rowNumber, ok: true })
      } catch (err) {
        results.push({ rowNumber: row.rowNumber, ok: false, error: err instanceof Error ? err.message : 'Failed' })
      }
      setOutcomes([...results])
    }
    setRunning(false)
    onImported()
  }

  const valid = rows?.filter(r => r.status === 'valid').length ?? 0
  const imported = outcomes.filter(o => o.ok).length

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Import aspects from a CSV</h2>
        <div className="flex gap-2">
          <button type="button" className={BUTTON_SECONDARY} onClick={downloadTemplate}>Download template</button>
          <button type="button" className={BUTTON_SECONDARY} onClick={onClose} disabled={running}>Close</button>
        </div>
      </div>
      <input type="file" accept=".csv,text/csv" aria-label="CSV file" disabled={running}
        onChange={e => void choose(e.target.files?.[0])} className="text-xs" />
      {headerError && <p className={FIELD_ERROR} role="alert">{headerError}</p>}
      {rows && !headerError && (
        <>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {valid} of {rows.length} rows are ready to import{rows.length > valid ? '; fix the others and choose the file again' : ''}.
          </p>
          <ul className="max-h-60 space-y-1 overflow-y-auto text-xs">
            {rows.map(row => {
              const outcome = outcomes.find(o => o.rowNumber === row.rowNumber)
              return (
                <li key={row.rowNumber} className={row.status === 'invalid' || (outcome && !outcome.ok) ? 'text-rose-700 dark:text-rose-300' : ''}>
                  Row {row.rowNumber}: {row.aspect.activity || '(no activity)'} — {row.aspect.processArea || '(no process area)'}
                  {row.score ? ` · ${row.score.operatingCondition} ${row.score.severity} × ${row.score.likelihood}` : ''}
                  {row.status === 'invalid' && ` · ${row.errors.join('; ')}`}
                  {outcome && (outcome.ok ? ' · imported' : ` · ${outcome.error}`)}
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-end gap-3">
            {outcomes.length > 0 && <span className="text-xs text-slate-500">{imported} imported</span>}
            <button type="button" className={BUTTON_PRIMARY} disabled={running || valid === 0 || outcomes.length > 0}
              onClick={() => void run()}>
              {running ? `Importing ${outcomes.length + 1} of ${valid}…` : `Import ${valid} rows`}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
