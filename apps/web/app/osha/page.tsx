'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertTriangle, FileText, Download, Settings, ShieldCheck } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  build300ASummary,
  trirFromSummary,
  dartFromSummary,
  type Osha300Row,
  type Osha300ASummary,
} from '@soteria/core/oshaForms'

// /osha — OSHA recordkeeping dashboard.
//
// Year + establishment switcher across the top. Cards show:
//   - 300A summary numbers (computed live from cached log entries)
//   - TRIR / DART reference rates
//   - Quick-link buttons: download 300 PDF, certify 300A, export ITA CSV
//
// Admin / member can view; certify + ITA are admin-only at the API.

interface EstablishmentRow {
  id:                          string
  establishment_name:          string
  hours_employees_by_year:     Record<string, { employees?: number; hours?: number }> | null
  certifying_executive_name:   string | null
  certifying_executive_title:  string | null
}

interface CertRow {
  certified_at: string | null
  certified_typed_name: string | null
  totals_json: Osha300ASummary | null
}

export default function OshaDashboardPage() {
  const { tenant } = useTenant()

  const now = new Date()
  const [year,    setYear]    = useState<number>(now.getFullYear())
  const [estId,   setEstId]   = useState<string>('')
  const [establishments, setEstablishments] = useState<EstablishmentRow[]>([])
  const [logRows, setLogRows] = useState<Osha300Row[]>([])
  const [cert,    setCert]    = useState<CertRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [busy,    setBusy]    = useState(false)

  const [signName, setSignName] = useState('')

  const load = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const estRes = await fetch('/api/osha/establishments', { headers })
      const estBody = await estRes.json()
      if (!estRes.ok) throw new Error(estBody.error ?? `HTTP ${estRes.status}`)
      const ests = (estBody.establishments as EstablishmentRow[])
      setEstablishments(ests)
      if (!estId && ests.length > 0) {
        setEstId(ests[0]!.id)
        return                     // a state change re-fires the effect
      }

      // Fetch the 300 log + (if establishment selected) 300A summary.
      const params = new URLSearchParams({ year: String(year) })
      if (estId) params.set('establishment', estId)
      const logRes = await fetch(`/api/osha/300?${params.toString()}`, { headers })
      const logBody = await logRes.json()
      if (!logRes.ok) throw new Error(logBody.error ?? `HTTP ${logRes.status}`)
      setLogRows(logBody.rows as Osha300Row[])

      if (estId) {
        const aRes = await fetch(`/api/osha/300a?year=${year}&establishment=${estId}`, { headers })
        const aBody = await aRes.json()
        if (aRes.ok) {
          setCert((aBody.certification as CertRow) ?? null)
        }
      } else {
        setCert(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, year, estId])

  useEffect(() => { void load() }, [load])

  const summary: Osha300ASummary | null = useMemo(() => {
    if (!estId || logRows.length === 0 && !cert) return null
    if (cert?.totals_json) return cert.totals_json
    const est = establishments.find(e => e.id === estId)
    const yearKey = String(year)
    const inputs = est?.hours_employees_by_year?.[yearKey] ?? { employees: 0, hours: 0 }
    return build300ASummary({
      rows: logRows, year,
      total_hours_worked:   inputs.hours    ?? 0,
      annual_avg_employees: inputs.employees ?? 0,
    })
  }, [logRows, cert, establishments, estId, year])

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = {
      'content-type':    'application/json',
      'x-active-tenant': tenant!.id,
    }
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  async function certify() {
    if (!estId) { setError('Pick an establishment first'); return }
    if (!signName.trim()) { setError('Type your name to certify'); return }
    setBusy(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch('/api/osha/300a', {
        method:  'POST',
        headers,
        body: JSON.stringify({
          year, establishment_id: estId,
          certified_typed_name: signName.trim(),
        }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSignName('')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  function downloadPdf(form: '300' | '300a') {
    if (!tenant?.id) return
    const params = new URLSearchParams({ year: String(year), format: 'pdf' })
    if (form === '300' && estId)  params.set('establishment', estId)
    if (form === '300a')          params.set('establishment', estId)
    // Server-side endpoints require the bearer token + tenant header,
    // which a plain anchor can't carry. We open a small window then
    // POST a form-style fetch + blob-download. Simpler in practice:
    // grab the bytes and trigger a download link.
    void (async () => {
      const headers = await authedHeaders()
      const url = `/api/osha/${form}?${params.toString()}`
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? `HTTP ${res.status}`); return
      }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `OSHA-${form === '300' ? '300' : '300A'}-${year}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    })()
  }

  function downloadIta() {
    if (!tenant?.id) return
    void (async () => {
      const headers = await authedHeaders()
      const res = await fetch(`/api/osha/ita-export?year=${year}`, { headers })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(j.error ?? `HTTP ${res.status}`); return
      }
      const blob = await res.blob()
      const link = document.createElement('a')
      link.href = URL.createObjectURL(blob)
      link.download = `ita-${year}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(link.href)
    })()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">OSHA recordkeeping</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            300 log, 300A annual summary, and the ITA annual upload.
          </p>
        </div>
        <Link
          href="/osha/establishments"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Settings className="h-3.5 w-3.5" />
          Establishments
        </Link>
      </header>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 dark:border-slate-800 p-3">
        <label className="text-xs text-slate-500 dark:text-slate-400">
          Year
          <input
            type="number"
            min="2000" max="2100"
            value={year}
            onChange={e => setYear(parseInt(e.target.value, 10) || now.getFullYear())}
            className="ml-2 w-24 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
          />
        </label>
        <label className="text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-[200px]">
          Establishment
          <select
            value={estId}
            onChange={e => setEstId(e.target.value)}
            className="ml-2 rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-sm"
          >
            <option value="">— pick one —</option>
            {establishments.map(e => (
              <option key={e.id} value={e.id}>{e.establishment_name}</option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {establishments.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">
            No OSHA establishments configured yet.
          </p>
          <Link
            href="/osha/establishments"
            className="inline-flex items-center gap-1 text-sm font-medium text-brand-navy hover:underline"
          >
            Add an establishment →
          </Link>
        </div>
      )}

      {summary && (
        <>
          <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <CountTile label="Deaths"             value={summary.total_deaths} />
            <CountTile label="Days-away cases"    value={summary.total_days_away} />
            <CountTile label="Restricted cases"   value={summary.total_restricted} />
            <CountTile label="Other recordable"   value={summary.total_other_recordable} />
            <CountTile label="Total days away"    value={summary.total_days_away_count} />
            <CountTile label="Total days restr."  value={summary.total_days_restricted_count} />
            <CountTile label="TRIR" value={trirFromSummary(summary)?.toFixed(2) ?? '—'} />
            <CountTile label="DART" value={dartFromSummary(summary)?.toFixed(2) ?? '—'} />
          </section>

          <section className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => downloadPdf('300')}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90"
            >
              <FileText className="h-3.5 w-3.5" />
              Download 300 PDF
            </button>
            <button
              type="button"
              onClick={() => downloadPdf('300a')}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90"
            >
              <FileText className="h-3.5 w-3.5" />
              Download 300A PDF
            </button>
            <button
              type="button"
              onClick={downloadIta}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              <Download className="h-3.5 w-3.5" />
              Export ITA CSV
            </button>
          </section>

          <section className={
            'rounded-xl border p-4 ' +
            (cert?.certified_at
              ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/20'
              : 'border-amber-200 bg-amber-50/40 dark:border-amber-900 dark:bg-amber-950/20')
          }>
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-900 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4" />
              {cert?.certified_at ? 'Certified' : 'Not yet certified'}
            </h2>
            {cert?.certified_at ? (
              <p className="mt-1 text-xs text-slate-700 dark:text-slate-300">
                Signed {new Date(cert.certified_at).toLocaleString()}
                {cert.certified_typed_name && ` by ${cert.certified_typed_name}`}.
                {' '}Once certified, edits to the underlying 300 log will not retroactively change this row.
              </p>
            ) : (
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Type your name to certify"
                  value={signName}
                  onChange={e => setSignName(e.target.value)}
                  className="flex-1 rounded-lg border border-amber-300 dark:border-amber-800 dark:bg-amber-950/40 px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  disabled={busy || !signName.trim()}
                  onClick={() => void certify()}
                  className="rounded-lg bg-amber-600 text-white px-4 py-2 text-xs font-semibold hover:bg-amber-700 disabled:opacity-50"
                >
                  Certify 300A
                </button>
              </div>
            )}
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
              {logRows.length} cases on the {year} log
            </h2>
            {logRows.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">No recordable cases yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700 text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Case #</th>
                      <th className="px-2 py-1.5 text-left">Employee</th>
                      <th className="px-2 py-1.5 text-left">Job</th>
                      <th className="px-2 py-1.5 text-left">Date</th>
                      <th className="px-2 py-1.5 text-left">Class</th>
                      <th className="px-2 py-1.5 text-right">Days away</th>
                      <th className="px-2 py-1.5 text-right">Restr.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                    {logRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                        <td className="px-2 py-1.5 font-mono">{r.case_number}</td>
                        <td className="px-2 py-1.5">{r.employee_name}</td>
                        <td className="px-2 py-1.5">{r.job_title ?? '—'}</td>
                        <td className="px-2 py-1.5">{r.date_of_injury}</td>
                        <td className="px-2 py-1.5">{r.classification.replace(/_/g, ' ')}</td>
                        <td className="px-2 py-1.5 text-right">{r.days_away || ''}</td>
                        <td className="px-2 py-1.5 text-right">{r.days_restricted || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function CountTile({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  )
}
