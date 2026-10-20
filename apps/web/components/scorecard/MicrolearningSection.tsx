'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle, CalendarClock, CheckCircle2, GraduationCap, Loader2, Percent, Target, UserCheck, Users,
  type LucideIcon,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MicrolearningRate, MicrolearningSummary } from '@soteria/core/strikeScorecard'
import { supabase } from '@/lib/supabase'
import { LOCALE_NAMES, MICROLEARNING_NOTES } from '@/lib/scorecardMicrolearning'
import { AXIS_TICK, CHART, TOOLTIP_STYLE } from './chartTheme'

// The EHS Scorecard's microlearning (STRIKE) infographic: how much training
// was completed, which modules, and whether the workforce is current. The
// numbers come from the same server summary the PDF, Excel and Word exports
// print, so the screen and the files always agree. Hidden when STRIKE is off.

type Tone = 'safe' | 'watch' | 'critical' | 'neutral'

const TONE: Record<Tone, { text: string; chip: string; border: string }> = {
  safe:     { text: 'text-emerald-700 dark:text-emerald-300', chip: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300', border: 'border-emerald-200 dark:border-emerald-900/60' },
  watch:    { text: 'text-amber-700 dark:text-amber-300', chip: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300', border: 'border-amber-200 dark:border-amber-900/60' },
  critical: { text: 'text-rose-700 dark:text-rose-300', chip: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300', border: 'border-rose-200 dark:border-rose-900/60' },
  neutral:  { text: 'text-slate-900 dark:text-slate-50', chip: 'bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/15 dark:text-brand-yellow', border: 'border-slate-200 dark:border-slate-800' },
}

/** 90% and up is on track, 70% and up needs watching: the scorecard's thresholds for completion rates. */
function percentTone(percent: number | null): Tone {
  if (percent === null) return 'neutral'
  return percent >= 90 ? 'safe' : percent >= 70 ? 'watch' : 'critical'
}

function rateDisplay(r: MicrolearningRate): { value: string; detail: string } {
  return r.percent === null
    ? { value: '—', detail: 'nothing to measure yet' }
    : { value: `${r.percent}%`, detail: `${r.numerator} of ${r.denominator}` }
}

export function MicrolearningSection({ tenantId, windowDays }: { tenantId: string; windowDays: number }) {
  const [summary, setSummary] = useState<MicrolearningSummary | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenantId }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/scorecard/microlearning?window=${windowDays}`, { headers })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setSummary(body.summary as MicrolearningSummary | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenantId, windowDays])

  useEffect(() => {
    setSummary(undefined)
    void load()
  }, [load])

  if (summary === null) return null

  return (
    <section aria-labelledby="microlearning-heading" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-2 pt-1">
        <h2 id="microlearning-heading" className="ops-section-title text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Microlearning (STRIKE) · last {windowDays} days
        </h2>
        <span aria-hidden="true" className="hidden h-px flex-1 bg-slate-200 sm:block dark:bg-slate-800" />
        <Link href="/strike/admin" className="ml-auto inline-flex min-h-11 items-center text-[11px] font-bold text-brand-navy hover:underline dark:text-brand-yellow">
          Compliance by worker &rarr;
        </Link>
      </div>

      {error ? (
        <div role="alert" className="ops-surface flex flex-wrap items-center gap-3 rounded-lg p-4 text-sm text-slate-600 dark:text-slate-300">
          <span>Couldn&apos;t load microlearning: {error}</span>
          <button type="button" onClick={() => void load()} className="motion-press min-h-11 rounded-md border border-slate-300 px-3 text-sm font-semibold dark:border-slate-700">
            Retry
          </button>
        </div>
      ) : summary === undefined ? (
        <div className="ops-surface flex justify-center rounded-lg p-8" aria-busy="true">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-label="Loading microlearning" />
        </div>
      ) : (
        <MicrolearningBody summary={summary} />
      )}
    </section>
  )
}

function MicrolearningBody({ summary: s }: { summary: MicrolearningSummary }) {
  const workforce = rateDisplay(s.workforceTrained)
  const firstTry = rateDisplay(s.firstTryPassRate)
  const nothingAssigned = s.compliance.assigned === 0
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={GraduationCap} label="Completed" value={String(s.completions)} detail={`${s.learners} ${s.learners === 1 ? 'person' : 'people'} trained`} tone="neutral" />
        <Kpi icon={Users} label="Workforce current" value={workforce.value} detail={workforce.detail} tone={percentTone(s.workforceTrained.percent)} />
        <Kpi
          icon={CheckCircle2}
          label="Assignments complete"
          value={nothingAssigned ? '—' : `${s.compliance.percentComplete}%`}
          detail={nothingAssigned ? 'nothing assigned yet' : `${s.compliance.complete} of ${s.compliance.assigned}`}
          tone={nothingAssigned ? 'neutral' : percentTone(s.compliance.percentComplete)}
        />
        <Kpi
          icon={AlertTriangle}
          label="Overdue"
          value={String(s.compliance.overdue)}
          detail={s.compliance.dueSoon > 0 ? `${s.compliance.dueSoon} due in 3 days` : 'assignments past due'}
          tone={s.compliance.overdue > 0 ? 'critical' : 'safe'}
        />
        <Kpi icon={CalendarClock} label="Expiring in 30 days" value={String(s.expiringSoon)} detail={`${s.expired} already lapsed`} tone={s.expired > 0 ? 'critical' : s.expiringSoon > 0 ? 'watch' : 'safe'} />
        <Kpi icon={Target} label="First-try pass" value={firstTry.value} detail={firstTry.detail} tone={percentTone(s.firstTryPassRate.percent)} />
        <Kpi
          icon={Percent}
          label="Average quiz score"
          value={s.averageScore === null ? '—' : `${s.averageScore}%`}
          detail={`${s.passRate.denominator} quiz ${s.passRate.denominator === 1 ? 'attempt' : 'attempts'}`}
          tone="neutral"
        />
        <Kpi
          icon={UserCheck}
          label="Supervisor-verified"
          value={String(s.delivery.assisted)}
          detail="ADA sign-offs, no quiz"
          tone="neutral"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Card title={s.trend.bucketDays === 1 ? 'Completions per day' : 'Completions per week'} subtitle="Passed modules, all languages and delivery modes">
          <CompletionTrend summary={s} />
        </Card>
        <Card title="Which modules" subtitle="Completions in the window, with quiz pass rate">
          <ModuleList summary={s} />
        </Card>
      </div>

      <Card title="Who and how" subtitle="Language, delivery and practice checks in the window">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SplitMeter
            label="Language"
            parts={s.languages.map((l, i) => ({ label: LOCALE_NAMES[l.locale] ?? l.locale, value: l.completions, color: i === 0 ? CHART.navy : i === 1 ? CHART.teal : CHART.amber }))}
          />
          <SplitMeter
            label="Delivery"
            parts={[
              { label: 'Quiz', value: s.delivery.standard, color: CHART.navy },
              { label: 'Supervisor-verified (ADA)', value: s.delivery.assisted, color: CHART.teal },
            ]}
          />
          <Fact label="Practice checks solved first try" value={rateDisplay(s.practice.solvedFirstTry)} />
          <Fact label="Practice checks that needed a hint" value={rateDisplay(s.practice.usedHint)} />
        </div>
        {s.permitOverrideWorkers > 0 && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
            {s.permitOverrideWorkers} {s.permitOverrideWorkers === 1 ? 'worker was' : 'workers were'} let onto a permit by override without the required training.
          </p>
        )}
      </Card>

      <ul className="space-y-1 text-[11px] text-slate-500 dark:text-slate-400">
        {MICROLEARNING_NOTES.map(note => <li key={note}>{note}</li>)}
      </ul>
    </>
  )
}

function Kpi({ icon: Icon, label, value, detail, tone }: { icon: LucideIcon; label: string; value: string; detail: string; tone: Tone }) {
  const style = TONE[tone]
  return (
    <article className={`ops-surface animate-panel-in rounded-lg border p-4 ${style.border}`} aria-label={`${label}: ${value}, ${detail}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">{label}</p>
        <span aria-hidden="true" className={`flex size-8 shrink-0 items-center justify-center rounded-md ${style.chip}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className={`mt-1 text-3xl font-black tabular-nums leading-none ${style.text}`}>{value}</p>
      <p className="mt-2 text-xs font-semibold text-slate-600 dark:text-slate-300">{detail}</p>
    </article>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="ops-surface animate-panel-in rounded-lg p-4">
      <header className="mb-3">
        <h3 className="ops-section-title text-sm font-black">{title}</h3>
        <p className="ops-muted text-xs">{subtitle}</p>
      </header>
      {children}
    </section>
  )
}

function CompletionTrend({ summary: s }: { summary: MicrolearningSummary }) {
  if (s.completions === 0) return <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">No completions in this window yet.</p>
  const data = s.trend.points.map(p => ({ label: p.start.slice(5), completions: p.completions }))
  return (
    <>
      {/* Colours swap to the dark theme's yellow, like the module meters beside it. */}
      <div aria-hidden="true" className="[--ml-bar:#1B3A6B] [--ml-grid:#dbe3ee] dark:[--ml-bar:#FFD900] dark:[--ml-grid:#334155]">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} margin={{ top: 8, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--ml-grid)" />
            <XAxis dataKey="label" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={12} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} width={40} />
            <Tooltip wrapperStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(27,58,107,0.08)' }} />
            <Bar dataKey="completions" name="Completions" fill="var(--ml-bar)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>{s.trend.bucketDays === 1 ? 'Completions per day' : 'Completions per week'}</caption>
        <thead><tr><th scope="col">{s.trend.bucketDays === 1 ? 'Day' : 'Week starting'}</th><th scope="col">Completions</th></tr></thead>
        <tbody>{s.trend.points.map(p => <tr key={p.start}><td>{p.start}</td><td>{p.completions}</td></tr>)}</tbody>
      </table>
    </>
  )
}

// Rows with meters rather than a horizontal bar chart: module titles are long,
// and a row keeps the whole title readable on a phone.
function ModuleList({ summary: s }: { summary: MicrolearningSummary }) {
  if (s.modules.length === 0) return <p className="py-10 text-center text-xs text-slate-400 dark:text-slate-500">No microlearning activity in this window yet.</p>
  const max = Math.max(1, ...s.modules.map(m => m.completions))
  return (
    <ul className="space-y-3">
      {s.modules.map(m => (
        <li key={m.moduleId}>
          <div className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 text-sm font-semibold text-slate-800 dark:text-slate-100">{m.title}</p>
            <p className="shrink-0 text-sm font-black tabular-nums text-slate-900 dark:text-slate-50">{m.completions}</p>
          </div>
          <div
            role="progressbar"
            aria-label={`${m.title}: ${m.completions} completions`}
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={m.completions}
            className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          >
            <div className="h-full rounded-full bg-brand-navy dark:bg-brand-yellow" style={{ width: `${(m.completions / max) * 100}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {m.learners} {m.learners === 1 ? 'person' : 'people'}
            {' · '}pass rate {m.passRate.percent === null ? '—' : `${m.passRate.percent}% (${m.passRate.numerator} of ${m.passRate.denominator})`}
            {m.assisted > 0 && ` · ${m.assisted} supervisor-verified`}
            {Object.keys(m.byLocale).length > 1 && ` · ${Object.entries(m.byLocale).map(([l, n]) => `${LOCALE_NAMES[l] ?? l} ${n}`).join(', ')}`}
          </p>
        </li>
      ))}
    </ul>
  )
}

function SplitMeter({ label, parts }: { label: string; parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0)
  return (
    <div>
      <p className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">{label}</p>
      {total === 0 ? (
        <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">No completions yet.</p>
      ) : (
        <>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" aria-hidden="true">
            {parts.filter(p => p.value > 0).map(p => <div key={p.label} style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
            {parts.map(p => (
              <li key={p.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="size-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
                {p.label}: <span className="font-bold tabular-nums">{p.value}</span> ({Math.round((p.value / total) * 100)}%)
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: { value: string; detail: string } }) {
  return (
    <div>
      <p className="text-[11px] font-black uppercase text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black tabular-nums text-slate-900 dark:text-slate-50">
        {value.value} <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{value.detail}</span>
      </p>
    </div>
  )
}
