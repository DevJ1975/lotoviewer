'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, FileUp, Loader2, Table2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { INJURY_TYPES, INJURY_TYPE_LABEL, type InjuryType } from '@soteria/core/oshaForms'
import { parseDelimited } from '@/lib/csv/parseDelimited'

// Historical import — backfill prior-year OSHA 300A annual summaries so the
// scorecard's year-over-year trend lines reach back further than this app's
// own incident history.
//
// Two import modes share the establishment picker:
//
//   PDF (Phase 2): one prior-year 300A PDF → AI reads the numbers →
//     human reviews/corrects → confirm → one osha_annual_summaries row.
//
//   CSV / spreadsheet (Phase 3a): a delimited export with one row per year →
//     map the export's columns to the 300A fields → preview the resolved
//     numbers → confirm ALL years at once. The big win is batch backfill: a
//     decade of summaries in a single upload instead of one PDF at a time.
//
// Both paths are tenant-admin gated and need the Bearer token +
// x-active-tenant header; the establishment list is an RLS-scoped read.

// The editable numeric fields. Mirrors AnnualSummaryFields from the
// extractor minus `year` (shown separately) and `by_injury_type` (its
// own grid below).
const SCALAR_FIELDS: { key: ScalarKey; label: string }[] = [
  { key: 'total_deaths',                label: 'Deaths (G)' },
  { key: 'total_days_away',             label: 'Cases w/ days away (H)' },
  { key: 'total_restricted',            label: 'Cases w/ job transfer or restriction (I)' },
  { key: 'total_other_recordable',      label: 'Other recordable cases (J)' },
  { key: 'total_days_away_count',       label: 'Total days away from work' },
  { key: 'total_days_restricted_count', label: 'Total days of job transfer/restriction' },
  { key: 'total_hours_worked',          label: 'Total hours worked' },
  { key: 'annual_avg_employees',        label: 'Annual average employees' },
]

type ScalarKey =
  | 'total_deaths'
  | 'total_days_away'
  | 'total_restricted'
  | 'total_other_recordable'
  | 'total_days_away_count'
  | 'total_days_restricted_count'
  | 'total_hours_worked'
  | 'annual_avg_employees'

interface ExtractedFields {
  year: number
  total_deaths: number
  total_days_away: number
  total_restricted: number
  total_other_recordable: number
  total_days_away_count: number
  total_days_restricted_count: number
  total_hours_worked: number
  annual_avg_employees: number
  by_injury_type: Record<InjuryType, number>
}

interface Establishment {
  id: string
  establishment_name: string
}

async function authHeaders(tenantId: string): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'x-active-tenant': tenantId,
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

type ImportMode = 'pdf' | 'csv'

export default function HistoryImportPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [mode, setMode] = useState<ImportMode>('pdf')

  const [establishments, setEstablishments] = useState<Establishment[]>([])
  const [establishmentId, setEstablishmentId] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedYear, setSavedYear] = useState<number | null>(null)
  const [savedCount, setSavedCount] = useState<number | null>(null)

  const [fields, setFields] = useState<ExtractedFields | null>(null)

  // Establishment dropdown — RLS-scoped read, so it only ever returns
  // the active tenant's rows.
  useEffect(() => {
    if (authLoading || !profile?.is_admin || !tenantId) return
    let cancelled = false
    ;(async () => {
      const { data, error: loadError } = await supabase
        .from('osha_establishments')
        .select('id, establishment_name')
        .order('establishment_name', { ascending: true })
      if (cancelled) return
      if (loadError) { setError('Could not load establishments.'); return }
      const rows = (data ?? []) as Establishment[]
      setEstablishments(rows)
      if (rows.length === 1) setEstablishmentId(rows[0]!.id)
    })()
    return () => { cancelled = true }
  }, [authLoading, profile, tenantId])

  function switchMode(next: ImportMode) {
    if (next === mode) return
    setMode(next)
    // Reset transient per-flow state so a half-finished import in one
    // mode doesn't leak into the other.
    setError(null); setSavedYear(null); setSavedCount(null)
    setFile(null); setFields(null)
  }

  async function onExtract() {
    if (!tenantId || !establishmentId || !file) return
    setExtracting(true); setError(null); setSavedYear(null); setFields(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/insights/history-import/extract', {
        method:  'POST',
        headers: await authHeaders(tenantId),
        body:    form,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Extraction failed (${res.status})`)
      setFields(json.fields as ExtractedFields)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not extract the summary.')
    } finally {
      setExtracting(false)
    }
  }

  async function onConfirm() {
    if (!tenantId || !establishmentId || !fields) return
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/insights/history-import/confirm', {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders(tenantId)) },
        body:    JSON.stringify({ establishmentId, year: fields.year, fields }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`)
      setSavedYear(json.year as number)
      setFields(null)
      setFile(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the annual summary.')
    } finally {
      setSaving(false)
    }
  }

  function setScalar(key: ScalarKey, raw: string) {
    setFields(prev => prev && { ...prev, [key]: clampInt(raw) })
  }
  function setInjury(type: InjuryType, raw: string) {
    setFields(prev => prev && { ...prev, by_injury_type: { ...prev.by_injury_type, [type]: clampInt(raw) } })
  }

  if (authLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="ops-surface-raised animate-panel-in rounded-lg px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            href="/admin"
            className="motion-press flex size-9 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:border-brand-navy/30 hover:bg-brand-navy/5 hover:text-brand-navy dark:border-slate-800 dark:text-slate-400 dark:hover:border-brand-yellow/30 dark:hover:bg-brand-yellow/10 dark:hover:text-brand-yellow"
            aria-label="Back to admin"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand-navy text-white dark:bg-brand-yellow dark:text-slate-950">
            <FileUp className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-black text-slate-950 dark:text-slate-50">Historical import</h1>
            <p className="ops-muted truncate text-sm">
              Backfill prior-year OSHA 300A summaries — from a PDF (AI reads it) or a spreadsheet (many years at once).
            </p>
          </div>
        </div>
      </header>

      {/* Mode toggle — PDF (one year, AI-read) vs CSV (many years, mapped). */}
      <div className="ops-surface animate-panel-in flex gap-1 rounded-lg p-1" role="tablist" aria-label="Import method">
        <ModeTab active={mode === 'pdf'} onClick={() => switchMode('pdf')} icon={<FileUp className="h-4 w-4" />} label="PDF" />
        <ModeTab active={mode === 'csv'} onClick={() => switchMode('csv')} icon={<Table2 className="h-4 w-4" />} label="CSV / spreadsheet" />
      </div>

      {error && (
        <div className="animate-panel-in rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-xs text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-100">
          {error}
        </div>
      )}

      {savedYear !== null && (
        <div className="animate-panel-in flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Saved the {savedYear} annual summary.{' '}
            <Link href="/admin/insights/scorecard" className="font-bold underline">View it on the scorecard &rarr;</Link>
          </span>
        </div>
      )}

      {savedCount !== null && (
        <div className="animate-panel-in flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-100">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>
            Saved {savedCount} {savedCount === 1 ? 'year' : 'years'}.{' '}
            <Link href="/admin/insights/scorecard" className="font-bold underline">View them on the scorecard &rarr;</Link>
          </span>
        </div>
      )}

      {mode === 'pdf' ? (
        <>
          {/* Step 1 — establishment + file */}
          <section className="ops-surface animate-panel-in space-y-4 rounded-lg p-4">
            <h2 className="ops-section-title text-sm font-black">1. Choose establishment &amp; PDF</h2>
            <EstablishmentSelect
              establishments={establishments}
              value={establishmentId}
              onChange={setEstablishmentId}
            />
            <div className="space-y-2">
              <label htmlFor="file" className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">300A PDF</label>
              <input
                id="file"
                type="file"
                accept="application/pdf,.pdf,text/plain,.txt,text/markdown,.md"
                onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-navy/90 dark:text-slate-200 dark:file:bg-brand-yellow dark:file:text-slate-950"
              />
            </div>
            <button
              onClick={onExtract}
              disabled={extracting || !establishmentId || !file}
              className="motion-press flex h-10 items-center gap-1.5 rounded-md bg-brand-navy px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy/90 disabled:opacity-50 dark:bg-brand-yellow dark:text-slate-950"
            >
              {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {extracting ? 'Reading the PDF…' : 'Extract numbers'}
            </button>
          </section>

          {/* Step 2 — review/edit */}
          {fields && (
            <section className="ops-surface animate-panel-in space-y-4 rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <h2 className="ops-section-title text-sm font-black">2. Review &amp; correct</h2>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                  Detected year {fields.year}
                </span>
              </div>
              <p className="ops-muted text-xs">
                The numbers below were read by AI. Check them against the form and fix anything wrong before saving — nothing is saved until you confirm.
              </p>

              <div className="space-y-2">
                <label htmlFor="year" className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Year</label>
                <input
                  id="year"
                  type="number"
                  inputMode="numeric"
                  value={fields.year}
                  onChange={e => setFields(prev => prev && { ...prev, year: clampInt(e.target.value) })}
                  className="h-10 w-32 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold tabular-nums text-slate-800 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {SCALAR_FIELDS.map(({ key, label }) => (
                  <NumberField key={key} id={key} label={label} value={fields[key]} onChange={v => setScalar(key, v)} />
                ))}
              </div>

              <div className="space-y-2">
                <p className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Cases by injury/illness type</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {INJURY_TYPES.map(type => (
                    <NumberField
                      key={type}
                      id={`injury-${type}`}
                      label={INJURY_TYPE_LABEL[type]}
                      value={fields.by_injury_type[type]}
                      onChange={v => setInjury(type, v)}
                    />
                  ))}
                </div>
              </div>

              <button
                onClick={onConfirm}
                disabled={saving}
                className="motion-press flex h-10 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {saving ? 'Saving…' : 'Confirm & save'}
              </button>
            </section>
          )}
        </>
      ) : (
        <CsvImport
          establishments={establishments}
          establishmentId={establishmentId}
          onEstablishmentChange={setEstablishmentId}
          tenantId={tenantId}
          onError={setError}
          onSaved={count => { setSavedCount(count); setSavedYear(null) }}
        />
      )}
    </div>
  )
}

function ModeTab({ active, onClick, icon, label }: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`motion-press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-bold transition ${
        active
          ? 'bg-brand-navy text-white shadow-sm dark:bg-brand-yellow dark:text-slate-950'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}

function EstablishmentSelect({ establishments, value, onChange }: {
  establishments: Establishment[]; value: string; onChange: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      <label htmlFor="establishment" className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Establishment</label>
      <select
        id="establishment"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="">Select an establishment…</option>
        {establishments.map(e => (
          <option key={e.id} value={e.id}>{e.establishment_name}</option>
        ))}
      </select>
      {establishments.length === 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          No establishments yet. Add one under{' '}
          <Link href="/osha" className="font-bold text-brand-navy hover:underline dark:text-brand-yellow">OSHA recordkeeping</Link> first.
        </p>
      )}
    </div>
  )
}

function NumberField({ id, label, value, onChange }: {
  id: string; label: string; value: number; onChange: (raw: string) => void
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={0}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold tabular-nums text-slate-800 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      />
    </div>
  )
}

// ── CSV / spreadsheet batch import ─────────────────────────────────────────

// The mappable fields, in the order they appear in the preview table. `year`
// is required; the eight 300A scalars are required; the six by_injury_type
// entries are optional (the 300A frequently leaves the breakdown blank).
const REQUIRED_COLUMNS: { key: MappableKey; label: string }[] = [
  { key: 'year',                        label: 'Year' },
  ...SCALAR_FIELDS,
]
const OPTIONAL_INJURY_COLUMNS: { key: MappableKey; label: string }[] =
  INJURY_TYPES.map(t => ({ key: `injury:${t}` as MappableKey, label: INJURY_TYPE_LABEL[t] }))

type MappableKey = 'year' | ScalarKey | `injury:${InjuryType}`

// How far back a 300A may be backfilled — must match MAX_BACKFILL_YEARS in
// lib/insights/annualSummaryRow.ts, which the server enforces. Duplicated as
// a literal (not imported) to keep this client bundle free of server code;
// the server is the source of truth, this only drives the preview's
// out-of-range flag.
const MAX_BACKFILL_YEARS = 20

// A parsed-but-unvalidated row keyed by mappable field. `null` = the mapped
// cell could not be read as a non-negative integer (preview flags it red).
type ResolvedRow = Record<MappableKey, number | null>

function CsvImport({ establishments, establishmentId, onEstablishmentChange, tenantId, onError, onSaved }: {
  establishments:        Establishment[]
  establishmentId:       string
  onEstablishmentChange: (id: string) => void
  tenantId:              string | null
  onError:               (message: string | null) => void
  onSaved:               (count: number) => void
}) {
  const [headers, setHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<MappableKey, string>>({} as Record<MappableKey, string>)
  const [saving, setSaving] = useState(false)

  async function onFile(file: File | null) {
    onError(null)
    setHeaders([]); setRawRows([]); setMapping({} as Record<MappableKey, string>)
    if (!file) return
    try {
      const text = await file.text()
      const { headers: parsedHeaders, rows } = parseDelimited(text)
      if (parsedHeaders.length === 0 || rows.length === 0) {
        onError('That file has no data rows. Export your summaries with a header row and one row per year.')
        return
      }
      setHeaders(parsedHeaders)
      setRawRows(rows)
      setMapping(guessMapping(parsedHeaders))
    } catch {
      onError('Could not read that file. Save it as CSV or TSV (UTF-8) and try again.')
    }
  }

  // Resolve every parsed row through the current mapping into numbers, so the
  // preview + the validity checks all read off one derivation.
  const resolved = useMemo<ResolvedRow[]>(
    () => rawRows.map(row => resolveRow(row, mapping)),
    [rawRows, mapping],
  )

  const thisYear = new Date().getFullYear()
  const minYear = thisYear - MAX_BACKFILL_YEARS

  // A row is invalid when year is out of range, or any required scalar is
  // non-numeric/missing. by_injury_type cells, when mapped, must also parse.
  const rowFlags = useMemo(
    () => resolved.map(r => rowIssues(r, minYear, thisYear)),
    [resolved, minYear, thisYear],
  )

  const yearMapped = !!mapping.year
  const invalidCount = rowFlags.filter(f => f.length > 0).length
  const canSave =
    !!establishmentId && !!tenantId && yearMapped && resolved.length > 0 && invalidCount === 0

  async function onConfirm() {
    if (!canSave || !tenantId) return
    setSaving(true); onError(null)
    try {
      const rows = resolved.map(toApiRow)
      const res = await fetch('/api/insights/history-import/confirm-batch', {
        method:  'POST',
        headers: { 'content-type': 'application/json', ...(await authHeaders(tenantId)) },
        body:    JSON.stringify({ establishmentId, rows }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `Save failed (${res.status})`)
      onSaved(json.saved as number)
      // Clear the staged import on success.
      setHeaders([]); setRawRows([]); setMapping({} as Record<MappableKey, string>)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save the annual summaries.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {/* Step 1 — establishment + file */}
      <section className="ops-surface animate-panel-in space-y-4 rounded-lg p-4">
        <h2 className="ops-section-title text-sm font-black">1. Choose establishment &amp; spreadsheet</h2>
        <EstablishmentSelect
          establishments={establishments}
          value={establishmentId}
          onChange={onEstablishmentChange}
        />
        <div className="space-y-2">
          <label htmlFor="csv-file" className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">CSV or TSV file</label>
          <input
            id="csv-file"
            type="file"
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            onChange={e => onFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-brand-navy file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:file:bg-brand-navy/90 dark:text-slate-200 dark:file:bg-brand-yellow dark:file:text-slate-950"
          />
          <p className="ops-muted text-xs">
            One row per year, with a header row. Exporting from Excel? Use{' '}
            <span className="font-semibold">File → Save As → CSV</span> — .xlsx isn’t read directly.
          </p>
        </div>
      </section>

      {/* Step 2 — column mapping */}
      {headers.length > 0 && (
        <section className="ops-surface animate-panel-in space-y-4 rounded-lg p-4">
          <h2 className="ops-section-title text-sm font-black">2. Map your columns</h2>
          <p className="ops-muted text-xs">
            We guessed which spreadsheet column feeds each 300A field. Correct any that are wrong.
            The injury/illness breakdown is optional — leave it unmapped if your export doesn’t have it.
          </p>

          <div className="space-y-3">
            <p className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Required</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {REQUIRED_COLUMNS.map(({ key, label }) => (
                <MappingSelect
                  key={key}
                  label={label}
                  headers={headers}
                  value={mapping[key] ?? ''}
                  allowNone={false}
                  onChange={v => setMapping(m => ({ ...m, [key]: v }))}
                />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Cases by injury/illness type (optional)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {OPTIONAL_INJURY_COLUMNS.map(({ key, label }) => (
                <MappingSelect
                  key={key}
                  label={label}
                  headers={headers}
                  value={mapping[key] ?? ''}
                  allowNone
                  onChange={v => setMapping(m => ({ ...m, [key]: v }))}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Step 3 — preview + confirm */}
      {headers.length > 0 && (
        <section className="ops-surface animate-panel-in space-y-4 rounded-lg p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="ops-section-title text-sm font-black">3. Preview &amp; save</h2>
            <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-black tabular-nums text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              {resolved.length} {resolved.length === 1 ? 'row' : 'rows'}
            </span>
          </div>

          {!yearMapped && (
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
              Map the <span className="font-black">Year</span> column to preview the rows.
            </p>
          )}

          {invalidCount > 0 && (
            <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
              {invalidCount} {invalidCount === 1 ? 'row has' : 'rows have'} an out-of-range year or a value that isn’t a
              whole number (highlighted below). Fix the mapping or the source file — the batch saves all-or-nothing.
            </p>
          )}

          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-800">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50 text-left dark:bg-slate-900/60">
                  {PREVIEW_COLUMNS.map(({ key, short }) => (
                    <th key={key} className="whitespace-nowrap px-2 py-2 font-black text-slate-600 dark:text-slate-300">{short}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {resolved.map((row, i) => {
                  const issues = rowFlags[i]!
                  return (
                    <tr key={i} className={issues.length > 0 ? 'bg-rose-50/70 dark:bg-rose-950/30' : ''}>
                      {PREVIEW_COLUMNS.map(({ key }) => {
                        const value = row[key]
                        const mapped = !!mapping[key]
                        const bad = issues.includes(key)
                        return (
                          <td
                            key={key}
                            className={`whitespace-nowrap px-2 py-1.5 tabular-nums ${
                              bad
                                ? 'font-bold text-rose-700 dark:text-rose-300'
                                : 'text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {!mapped ? <span className="text-slate-400 dark:text-slate-600">—</span>
                              : value === null ? <span title="Not a whole number">⚠︎</span>
                              : value}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <button
            onClick={onConfirm}
            disabled={!canSave || saving}
            className="motion-press flex h-10 items-center gap-1.5 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {saving ? 'Saving…' : `Confirm & save all ${resolved.length} ${resolved.length === 1 ? 'year' : 'years'}`}
          </button>
        </section>
      )}
    </>
  )
}

function MappingSelect({ label, headers, value, allowNone, onChange }: {
  label: string; headers: string[]; value: string; allowNone: boolean; onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-md border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 shadow-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        <option value="">{allowNone ? '(not in my file)' : 'Select a column…'}</option>
        {headers.map(h => (
          <option key={h} value={h}>{h}</option>
        ))}
      </select>
    </div>
  )
}

// Short labels for the preview table header — the field labels are too wide
// for a dense, many-column table.
const PREVIEW_COLUMNS: { key: MappableKey; short: string }[] = [
  { key: 'year',                        short: 'Year' },
  { key: 'total_deaths',                short: 'Deaths' },
  { key: 'total_days_away',             short: 'DAFW cases' },
  { key: 'total_restricted',            short: 'Restr. cases' },
  { key: 'total_other_recordable',      short: 'Other cases' },
  { key: 'total_days_away_count',       short: 'DAFW days' },
  { key: 'total_days_restricted_count', short: 'Restr. days' },
  { key: 'total_hours_worked',          short: 'Hours' },
  { key: 'annual_avg_employees',        short: 'Avg empl.' },
  ...INJURY_TYPES.map(t => ({ key: `injury:${t}` as MappableKey, short: INJURY_TYPE_LABEL[t] })),
]

// Parse a free-typed cell to a non-negative whole number, or null if it
// can't be — mirrors the server's asCount so the preview's red flags match
// what confirm-batch would reject. Strips thousands separators ("1,200") and
// surrounding whitespace, which spreadsheet exports routinely include.
function parseCount(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const cleaned = raw.replace(/,/g, '').trim()
  if (cleaned === '') return null
  const n = Number(cleaned)
  if (!Number.isInteger(n) || n < 0) return null
  return n
}

// Coerce a free-typed input to a non-negative whole number for the PDF
// form state. The confirm route re-validates server-side; this just keeps
// the controlled inputs sane while editing.
function clampInt(raw: string): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

// Resolve one parsed CSV row into the mappable numeric shape. Unmapped keys
// resolve to null (rendered "—" and ignored by required-field checks unless
// the field is required).
function resolveRow(row: Record<string, string>, mapping: Record<MappableKey, string>): ResolvedRow {
  const out = {} as ResolvedRow
  for (const { key } of PREVIEW_COLUMNS) {
    const header = mapping[key]
    out[key] = header ? parseCount(row[header]) : null
  }
  return out
}

// Which preview cells make a row invalid: the year out of range, or any
// required scalar that's missing/non-numeric. Mapped injury cells that fail
// to parse also count. Unmapped optional injury cells are fine.
function rowIssues(row: ResolvedRow, minYear: number, maxYear: number): MappableKey[] {
  const issues: MappableKey[] = []
  const year = row.year
  if (year === null || year < minYear || year > maxYear) issues.push('year')
  for (const { key } of SCALAR_FIELDS) {
    if (row[key] === null) issues.push(key)
  }
  return issues
}

// Build the JSON row confirm-batch expects from a resolved preview row.
// Required scalars are guaranteed non-null at the call site (canSave gates
// on zero invalid rows); we coalesce to 0 defensively. Injury types only
// ride along when mapped.
function toApiRow(row: ResolvedRow) {
  const by_injury_type: Partial<Record<InjuryType, number>> = {}
  for (const t of INJURY_TYPES) {
    const v = row[`injury:${t}`]
    if (v !== null) by_injury_type[t] = v
  }
  return {
    year:                        row.year ?? 0,
    total_deaths:                row.total_deaths ?? 0,
    total_days_away:             row.total_days_away ?? 0,
    total_restricted:            row.total_restricted ?? 0,
    total_other_recordable:      row.total_other_recordable ?? 0,
    total_days_away_count:       row.total_days_away_count ?? 0,
    total_days_restricted_count: row.total_days_restricted_count ?? 0,
    total_hours_worked:          row.total_hours_worked ?? 0,
    annual_avg_employees:        row.annual_avg_employees ?? 0,
    ...(Object.keys(by_injury_type).length > 0 ? { by_injury_type } : {}),
  }
}

// Fuzzy header → field matcher. Each field carries an ordered list of
// substring tests against the lower-cased, punctuation-stripped header.
// First field to claim a header wins; a header is never mapped twice.
//
// The subtle case: "days away" appears in BOTH total_days_away (a CASE
// count, column H) and total_days_away_count (a DAY count). We disambiguate
// by requiring the day-count fields to mention "day(s)" as a NUMBER/TOTAL
// ("number of days", "total days", "days lost") while the case fields look
// for "case". Day-count guesses are tried FIRST so a header like
// "Total days away from work" lands on the count, not the case column.
const HEADER_GUESSES: { key: MappableKey; tests: ((h: string) => boolean)[] }[] = [
  { key: 'year', tests: [h => h === 'year', h => h.includes('year'), h => h.includes('cy')] },

  // Day-count fields first (see note above) — they out-prioritise the
  // similarly-worded case fields.
  { key: 'total_days_away_count', tests: [
    h => h.includes('day') && h.includes('away') && (h.includes('number') || h.includes('total') || h.includes('lost') || h.includes('count')),
    h => h.includes('dafw') && (h.includes('day') || h.includes('lost')),
  ] },
  { key: 'total_days_restricted_count', tests: [
    h => h.includes('day') && (h.includes('restrict') || h.includes('transfer') || h.includes('djtr')) && (h.includes('number') || h.includes('total') || h.includes('count')),
    h => h.includes('djtr') && h.includes('day'),
  ] },

  { key: 'total_deaths', tests: [h => h.includes('death'), h => h === 'g'] },
  { key: 'total_days_away', tests: [
    h => h.includes('case') && h.includes('away'),
    h => h.includes('dafw') && h.includes('case'),
    h => h.includes('days away'),
    h => h === 'h',
  ] },
  { key: 'total_restricted', tests: [
    h => h.includes('case') && (h.includes('restrict') || h.includes('transfer')),
    h => h.includes('djtr') && h.includes('case'),
    h => h.includes('restrict') || h.includes('transfer'),
    h => h === 'i',
  ] },
  { key: 'total_other_recordable', tests: [
    h => h.includes('other') && (h.includes('record') || h.includes('case')),
    h => h === 'j',
  ] },
  { key: 'total_hours_worked', tests: [h => h.includes('hour')] },
  { key: 'annual_avg_employees', tests: [
    h => h.includes('average') && h.includes('employ'),
    h => h.includes('avg') && h.includes('employ'),
    h => h.includes('employ'),
  ] },

  // Injury/illness breakdown.
  { key: 'injury:skin_disorder', tests: [h => h.includes('skin')] },
  { key: 'injury:respiratory',   tests: [h => h.includes('respirat')] },
  { key: 'injury:poisoning',     tests: [h => h.includes('poison')] },
  { key: 'injury:hearing_loss',  tests: [h => h.includes('hearing')] },
  { key: 'injury:other_illness', tests: [h => h.includes('other') && h.includes('illness')] },
  // "injury" is broad — try it last so the more specific illness columns and
  // the case columns (which also contain "injuries") claim their headers first.
  { key: 'injury:injury', tests: [h => h.includes('injuries'), h => h === 'injury'] },
]

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[_\-./()]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function guessMapping(headers: string[]): Record<MappableKey, string> {
  const normalized = headers.map(h => ({ raw: h, norm: normalizeHeader(h) }))
  const claimed = new Set<string>()
  const mapping = {} as Record<MappableKey, string>

  for (const { key, tests } of HEADER_GUESSES) {
    for (const test of tests) {
      const hit = normalized.find(h => !claimed.has(h.raw) && test(h.norm))
      if (hit) { mapping[key] = hit.raw; claimed.add(hit.raw); break }
    }
  }
  return mapping
}
