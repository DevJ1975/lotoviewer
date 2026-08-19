'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, FileDown, Loader2, MinusCircle, Mountain,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { fetchIso14001Signals } from '@/lib/iso14001Signals'
import {
  assessIso14001,
  type ClauseVerdict,
  type Iso14001ReportCard,
} from '@soteria/core/iso14001Readiness'

// /environmental/report-card — the module's reason to exist.
//
// Reads the EMS registers and says what an auditor would say. Two rules
// govern every word on this page:
//
//   1. Never the word "compliant". We report evidence coverage; only a
//      certification body determines conformity.
//   2. A blocking finding outranks the percentage. One open major fails
//      an audit however green the rest is, so the band — not the number —
//      is the headline.

const VERDICT_META: Record<ClauseVerdict, {
  label: string
  Icon:  typeof CheckCircle2
  chip:  string
  rail:  string
}> = {
  conforming: {
    label: 'Evidenced',
    Icon:  CheckCircle2,
    chip:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
    rail:  'bg-emerald-500',
  },
  attention: {
    label: 'Needs attention',
    Icon:  AlertTriangle,
    chip:  'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
    rail:  'bg-amber-500',
  },
  gap: {
    label: 'No evidence',
    Icon:  CircleDashed,
    chip:  'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
    rail:  'bg-rose-500',
  },
  not_applicable: {
    label: 'Not applicable',
    Icon:  MinusCircle,
    chip:  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    rail:  'bg-slate-300 dark:bg-slate-700',
  },
}

const BAND_META: Record<Iso14001ReportCard['band'], { label: string; tone: string }> = {
  ready: {
    label: 'Ready for a certification audit',
    tone:  'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  },
  ready_with_gaps: {
    label: 'Ready with gaps',
    tone:  'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  },
  not_ready: {
    label: 'Not ready',
    tone:  'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  },
}

export default function Iso14001ReportCardPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenant, tenantId } = useTenant()

  const [card, setCard]           = useState<Iso14001ReportCard | null>(null)
  const [generatedAt, setStamp]   = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const signals = await fetchIso14001Signals(tenantId, tenant?.modules ?? null)
      setCard(assessIso14001(signals))
      setStamp(new Date().toISOString())
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not build the report card.')
    }
  }, [tenantId, tenant])

  useEffect(() => { void load() }, [load])

  async function exportPdf() {
    if (!card || !generatedAt) return
    setExporting(true)
    try {
      const { generateIso14001ReportCard } = await import('@/lib/pdfIso14001ReportCard')
      const bytes = await generateIso14001ReportCard({
        card,
        tenantName: tenant?.name ?? 'Organization',
        generatedAt,
      })
      const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `iso14001-audit-readiness-${generatedAt.slice(0, 10)}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not export the report card.')
    } finally {
      setExporting(false)
    }
  }

  if (authLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><OpsSpinner /></div>
  }
  if (!profile) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500 dark:text-slate-400">
        Sign in to view the report card.
      </div>
    )
  }

  const applicable = card ? card.clauses.length - card.counts.not_applicable : 0

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <PageHeader
        icon={Mountain}
        eyebrow="ISO 14001:2015"
        title="Audit readiness"
        description="Clause-by-clause evidence held in this platform, and what is missing before a certification audit."
        back="/environmental"
        actions={
          <button
            type="button"
            onClick={() => void exportPdf()}
            disabled={!card || exporting}
            className="motion-press inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:border-brand-navy/30 hover:bg-brand-navy/5 disabled:opacity-50 dark:border-slate-800 dark:text-slate-300 dark:hover:border-brand-yellow/30 dark:hover:bg-brand-yellow/10"
          >
            {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
            Export PDF
          </button>
        }
      />

      {loadError && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{loadError}</span>
        </div>
      )}

      {!card ? (
        <div className="flex items-center justify-center py-16"><OpsSpinner label="ASSESSING" /></div>
      ) : (
        <>
          {/* Verdict first. The band is the answer; the percentage is
              supporting detail, never the other way round. */}
          <section className={`rounded-xl border-2 p-4 ${BAND_META[card.band].tone}`}>
            <p className="placard-label-lg">{BAND_META[card.band].label}</p>
            <p className="mt-1 text-sm">{card.headline}</p>
          </section>

          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="rounded-xl border border-slate-100 bg-white px-5 py-4 dark:border-slate-800 dark:bg-slate-900">
              <p className="placard-numeric text-4xl font-bold text-brand-navy dark:text-brand-yellow">
                {card.coverage}%
              </p>
              <p className="placard-label mt-1 text-slate-500 dark:text-slate-400">Evidence coverage</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                {card.counts.conforming} of {applicable} applicable clauses
              </p>
            </div>

            <div className="rounded-xl border border-slate-100 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(VERDICT_META) as ClauseVerdict[]).map(v => (
                  <span key={v} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${VERDICT_META[v].chip}`}>
                    {card.counts[v]} {VERDICT_META[v].label}
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                Evidence coverage measures whether records exist and are current <em>in this platform</em>.
                It is not a statement of conformity — only an accredited certification body determines that.
                Blocking findings fail an audit regardless of coverage.
              </p>
            </div>
          </div>

          {card.blockers.length > 0 && (
            <section className="rounded-xl border border-rose-200 bg-white dark:border-rose-900 dark:bg-slate-900">
              <h2 className="ops-section-title border-b border-rose-100 px-4 py-2 text-rose-700 dark:border-rose-900 dark:text-rose-300">
                Blocking findings
              </h2>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {card.blockers.map(b => (
                  <li key={b.code} className="px-4 py-3">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span className="placard-numeric mr-2 text-rose-600 dark:text-rose-400">{b.code}</span>
                      {b.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{b.reason}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
            <h2 className="ops-section-title border-b border-slate-100 px-4 py-2 dark:border-slate-800">
              Clause-by-clause
            </h2>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {card.clauses.map(c => {
                const meta = VERDICT_META[c.verdict]
                return (
                  <li key={c.code} className="relative flex flex-wrap items-start gap-x-4 gap-y-1 py-3 pl-5 pr-4">
                    <span aria-hidden="true" className={`absolute left-0 top-3 bottom-3 w-1 rounded-r-sm ${meta.rail}`} />
                    <span className="placard-numeric w-12 shrink-0 pt-0.5 text-xs font-bold text-slate-900 dark:text-slate-100">
                      {c.code}
                    </span>
                    <span className="min-w-[10rem] flex-1 text-sm text-slate-800 dark:text-slate-200">
                      {c.title}
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{c.reason}</span>
                    </span>
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
                      <meta.Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                    <span className="w-20 shrink-0 text-right">
                      {c.fixHref && c.verdict !== 'conforming' && c.verdict !== 'not_applicable' && (
                        <Link
                          href={c.fixHref}
                          className="inline-flex items-center gap-0.5 text-xs font-semibold text-brand-navy hover:underline dark:text-brand-yellow"
                        >
                          Fix <ArrowRight className="h-3 w-3" />
                        </Link>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
