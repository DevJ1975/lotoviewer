'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import {
  parseConfinedSpaceCsv,
  toInsertPayload,
  type ParsedSpaceRow,
} from '@/lib/csvImportConfinedSpaces'

// Bulk-seed the inventory from a CSV file. Three-step flow matching the
// existing /import page for LOTO equipment: pick file → preview rows →
// import. Existing rows are detected post-parse via a single SELECT
// against loto_confined_spaces so the preview can show new vs. duplicate
// before the user commits.

const BATCH_SIZE = 100

type Phase = 'pick' | 'preview' | 'importing' | 'done'

export default function ImportConfinedSpacesPage() {
  const [phase, setPhase]               = useState<Phase>('pick')
  const [parseErrors, setParseErrors]   = useState<string[]>([])
  const [rows, setRows]                 = useState<ParsedSpaceRow[]>([])
  const [importedCount, setImportedCount] = useState(0)
  const [importErrors, setImportErrors] = useState<string[]>([])

  const handleFile = useCallback(async (file: File) => {
    const { rows: parsed, errors } = await parseConfinedSpaceCsv(file)
    setParseErrors(errors)
    if (parsed.length === 0 && errors.length > 0) {
      // Fatal parse error (header missing, file empty) — stay on pick step.
      return
    }

    // Mark existing rows by hitting Supabase once with all the IDs.
    const ids = parsed.map(r => r.space_id).filter(Boolean)
    if (ids.length > 0) {
      const { data, error } = await supabase
        .from('loto_confined_spaces')
        .select('space_id')
        .in('space_id', ids)
      if (error) {
        setParseErrors(prev => [...prev, `Could not check existing rows: ${error.message}`])
      } else if (data) {
        const existing = new Set(data.map((r: { space_id: string }) => r.space_id))
        for (const r of parsed) {
          if (r.status === 'invalid') continue
          if (existing.has(r.space_id)) r.status = 'existing'
        }
      }
    }
    setRows(parsed)
    setPhase('preview')
  }, [])

  const handleImport = useCallback(async () => {
    setPhase('importing')
    setImportErrors([])
    const toInsert = rows.filter(r => r.status === 'new').map(toInsertPayload)
    let inserted = 0
    const errors: string[] = []
    for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
      const batch = toInsert.slice(i, i + BATCH_SIZE)
      const { error } = await supabase.from('loto_confined_spaces').insert(batch)
      if (error) {
        errors.push(`Batch starting at row ${i + 1}: ${error.message}`)
      } else {
        inserted += batch.length
      }
    }
    setImportedCount(inserted)
    setImportErrors(errors)
    setPhase('done')
  }, [rows])

  const stats = rows.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1
      return acc
    },
    { new: 0, existing: 0, invalid: 0 } as Record<ParsedSpaceRow['status'], number>,
  )

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <Link href="/confined-spaces" className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          ← Back to Confined Spaces
        </Link>
      </div>

      <header>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Import Confined Spaces</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Bulk-seed the inventory from a CSV file. Existing rows (matched on space_id) are skipped.</p>
      </header>

      {phase === 'pick' && (
        <>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <strong>Required columns:</strong> <span className="font-mono text-xs">space_id, description, department</span>
            </p>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              <strong>Optional columns:</strong>{' '}
              <span className="font-mono text-xs">space_type, classification, entry_dimensions, known_hazards, isolation_required</span>
            </p>
            <div className="bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 rounded-lg p-3 text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
              space_id,description,department,space_type,classification,known_hazards<br />
              CS-MIX-04,South side mixing tank #4,Packaging,tank,permit_required,Engulfment;CIP residue<br />
              CS-SILO-01,Flour silo east,Bakery,silo,permit_required,Dust explosion;Engulfment;O2 deficiency
            </div>
            <ul className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed space-y-0.5">
              <li>• <strong>space_type</strong>: tank, silo, vault, pit, hopper, vessel, sump, plenum, manhole, other</li>
              <li>• <strong>classification</strong>: permit_required, non_permit, reclassified — defaults to permit_required if omitted</li>
              <li>• <strong>known_hazards</strong>: semicolon-separated list (use commas if you wrap the cell in quotes)</li>
            </ul>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 text-center">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Choose a CSV file to begin</p>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
              className="block mx-auto text-sm"
            />
          </div>

          {parseErrors.length > 0 && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-800 dark:text-rose-200 space-y-0.5">
              {parseErrors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}
        </>
      )}

      {phase === 'preview' && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Stat label="New"      value={stats.new}      tone="emerald" />
            <Stat label="Existing" value={stats.existing} tone="slate" />
            <Stat label="Invalid"  value={stats.invalid}  tone="rose" />
          </div>

          {parseErrors.length > 0 && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
              {parseErrors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 dark:bg-slate-900/40 border-b border-slate-200 dark:border-slate-700">
                  <tr>
                    <Th>Status</Th>
                    <Th>Space ID</Th>
                    <Th>Description</Th>
                    <Th>Dept</Th>
                    <Th>Type</Th>
                    <Th>Class</Th>
                    <Th>Hazards</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800 last:border-b-0">
                      <Td>
                        <StatusPill status={r.status} />
                      </Td>
                      <Td><span className="font-mono">{r.space_id || <em className="text-slate-400 dark:text-slate-500">—</em>}</span></Td>
                      <Td>{r.description}</Td>
                      <Td>{r.department}</Td>
                      <Td>{r.space_type}</Td>
                      <Td>{r.classification}</Td>
                      <Td>{r.known_hazards.join('; ')}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {rows.some(r => r.status === 'invalid') && (
            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
              {rows.filter(r => r.status === 'invalid').map((r, i) => (
                <p key={i}>• <span className="font-mono">{r.space_id || `(line ${i + 2})`}</span>: {r.error}</p>
              ))}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => { setRows([]); setParseErrors([]); setPhase('pick') }}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Choose different file
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={stats.new === 0}
              className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              Import {stats.new} new {stats.new === 1 ? 'space' : 'spaces'}
            </button>
          </div>
        </>
      )}

      {phase === 'importing' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-12 text-center">
          <div className="w-10 h-10 mx-auto mb-3 border-4 border-brand-navy border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Importing…</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-6 space-y-3">
          <p className="text-base font-bold text-slate-900 dark:text-slate-100">
            Imported {importedCount} space{importedCount === 1 ? '' : 's'}.
          </p>
          {importErrors.length > 0 && (
            <div className="bg-rose-50 dark:bg-rose-950/40 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-800 dark:text-rose-200 space-y-0.5">
              <p className="font-semibold">Some batches failed:</p>
              {importErrors.map((e, i) => <p key={i}>• {e}</p>)}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Link
              href="/confined-spaces"
              className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
            >
              Go to Confined Spaces
            </Link>
            <button
              type="button"
              onClick={() => { setRows([]); setParseErrors([]); setImportedCount(0); setImportErrors([]); setPhase('pick') }}
              className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'slate' | 'rose' }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 text-emerald-900 dark:text-emerald-100'
            : tone === 'rose'    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 text-rose-900 dark:text-rose-100'
            :                       'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
  return (
    <div className={`rounded-xl border ${cls} p-4`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-0.5">{value}</p>
    </div>
  )
}

function StatusPill({ status }: { status: ParsedSpaceRow['status'] }) {
  const cls = status === 'new'      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200'
            : status === 'existing' ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
            :                          'bg-rose-100 dark:bg-rose-900/40 text-rose-800 dark:text-rose-200'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-3 py-1.5 text-slate-700 dark:text-slate-300">{children}</td>
}
