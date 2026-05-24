'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle2, FileUp, Loader2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { INJURY_TYPES, INJURY_TYPE_LABEL, type InjuryType } from '@soteria/core/oshaForms'

// Historical import — upload a prior-year OSHA 300A PDF, let AI read the
// numbers, review/correct them, then confirm to upsert an annual summary.
//
// Three steps in one page:
//   1. Pick an establishment + a PDF → POST to /extract (no DB write).
//   2. Edit the extracted numbers in a form (human-in-the-loop).
//   3. Confirm → POST to /confirm → the row lands in osha_annual_summaries
//      and feeds the scorecard's year-over-year chart.
//
// The extract + confirm routes are tenant-admin gated and need the
// Bearer token + x-active-tenant header (same posture as the scorecard's
// PDF export); RLS-scoped supabase reads cover the establishment list.

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

export default function HistoryImportPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [establishments, setEstablishments] = useState<Establishment[]>([])
  const [establishmentId, setEstablishmentId] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const [extracting, setExtracting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedYear, setSavedYear] = useState<number | null>(null)

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
              Upload a prior-year OSHA 300A — AI reads the numbers for your review, then fills the scorecard.
            </p>
          </div>
        </div>
      </header>

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

      {/* Step 1 — establishment + file */}
      <section className="ops-surface animate-panel-in space-y-4 rounded-lg p-4">
        <h2 className="ops-section-title text-sm font-black">1. Choose establishment &amp; PDF</h2>
        <div className="space-y-2">
          <label htmlFor="establishment" className="block text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Establishment</label>
          <select
            id="establishment"
            value={establishmentId}
            onChange={e => setEstablishmentId(e.target.value)}
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

// Coerce a free-typed input to a non-negative whole number for the form
// state. The confirm route re-validates server-side; this just keeps the
// controlled inputs sane while editing.
function clampInt(raw: string): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}
