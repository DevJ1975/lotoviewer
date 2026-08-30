'use client'

import { useMemo, type ReactNode } from 'react'
import { TrendingDown, TrendingUp, Minus } from 'lucide-react'
import type { IncidentScorecardMetrics } from '@soteria/core/incidentScorecardMetrics'
import { forecastCount, cChartLimits, assessTrend, type TrendStatus } from '@soteria/core/forecast'
import { ForecastChart } from './ForecastChart'
import { ControlChart } from './ControlChart'
import { DistributionChart } from './DistributionChart'
import type { MetricDetail } from './metricDetail'

// "Where things are going" — the predictive + distribution surface for the
// headline recordable trend. Every number comes from the deterministic core
// (forecastCount / cChartLimits / assessTrend); this section only wires the
// monthly series in and gates each view on having enough data to be honest:
//   - forecast needs ≥ 6 months,
//   - the c-chart needs ≥ 2 months,
//   - the Poisson distribution needs ≥ 8 months (else it would mislead).

const MIN_DISTRIBUTION_MONTHS = 8

function monthShort(ym: string): string {
  const [y, mo] = ym.split('-').map(Number)
  if (!y || !mo) return ym
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleDateString('en-US', { month: 'short' })
}

const TREND_META: Record<TrendStatus, { label: string; cls: string; Icon: typeof TrendingUp }> = {
  improving: { label: 'Improving', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200', Icon: TrendingDown },
  worsening: { label: 'Worsening', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200', Icon: TrendingUp },
  flat:      { label: 'Flat / no reliable trend', cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200', Icon: Minus },
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

export function PredictiveSection({ metrics: m, onDrill }: {
  metrics: IncidentScorecardMetrics
  onDrill: (d: MetricDetail) => void
}) {
  const recCounts = useMemo(() => m.recordablesByMonth.map(b => b.count), [m.recordablesByMonth])
  const recLabels = useMemo(() => m.recordablesByMonth.map(b => monthShort(b.month)), [m.recordablesByMonth])
  const forecast = useMemo(() => forecastCount(recCounts), [recCounts])
  const cLimits = useMemo(() => cChartLimits(recCounts), [recCounts])
  const trend = useMemo(() => assessTrend(recCounts, { lowerIsBetter: true, target: 0 }), [recCounts])

  if (recCounts.length < 2) return null // nothing meaningful to predict yet

  const history = recLabels.map((label, i) => ({ label, value: recCounts[i]! }))
  const trendMeta = trend ? TREND_META[trend.status] : TREND_META.flat
  const detail = predictiveDetail(forecast?.expected ?? null, forecast?.lower ?? null, forecast?.upper ?? null, recCounts.length)

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="ops-section-title text-[11px] font-black uppercase tracking-widest text-slate-500 dark:text-slate-400">Where things are going · predictive</span>
        <span aria-hidden="true" className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
      </div>

      {/* Headline summary — tap for the methodology + caveats. */}
      <button
        type="button"
        onClick={() => onDrill(detail)}
        className="motion-press ops-surface animate-panel-in flex w-full flex-col gap-2 rounded-lg p-4 text-left outline-none hover:border-brand-navy/30 focus-visible:ring-2 focus-visible:ring-brand-navy/40 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${trendMeta.cls}`}>
            <trendMeta.Icon className="h-3.5 w-3.5" /> {trendMeta.label}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">recordable trend (12 mo)</span>
        </div>
        <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {forecast
            ? <>Projected next month: <span className="font-black tabular-nums text-slate-900 dark:text-slate-50">{forecast.expected.toFixed(1)}</span> <span className="text-xs text-slate-500">(95% PI {forecast.lower.toFixed(1)}–{forecast.upper.toFixed(1)})</span></>
            : <span className="text-xs text-slate-500">Need ≥ 6 months for a projection.</span>}
        </div>
      </button>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {forecast && (
          <Card title="Recordable forecast" subtitle="Actuals, projected next month, and the Poisson 95% interval.">
            <ForecastChart history={history} forecast={forecast} valueName="Recordables" projectionLabel="Next" />
          </Card>
        )}
        {cLimits && (
          <Card title="Recordable control chart (c-chart)" subtitle="Monthly counts vs the mean and ±3σ control limits. Points above UCL warrant a look.">
            <ControlChart data={history} limits={cLimits} valueName="Recordables" />
          </Card>
        )}
      </div>

      <Card title="Distribution of monthly recordables" subtitle="Observed monthly counts vs the fitted Poisson model — the honest distribution for rare events (not a bell curve).">
        {recCounts.length >= MIN_DISTRIBUTION_MONTHS
          ? <DistributionChart counts={recCounts} valueName="recordables" />
          : <p className="py-8 text-center text-xs text-slate-400 dark:text-slate-500">Insufficient data for a distribution — need at least {MIN_DISTRIBUTION_MONTHS} months ({recCounts.length} so far).</p>}
      </Card>
    </section>
  )
}

function predictiveDetail(expected: number | null, lower: number | null, upper: number | null, months: number): MetricDetail {
  return {
    title: 'Recordable forecast & distribution',
    category: 'Predictive',
    definition: 'A transparent, deterministic projection of next month’s recordable count from the trailing monthly series — never an AI guess, so the same data always yields the same number.',
    formula: 'EWMA level (α=0.3) + linear trend (only when r² ≥ 0.3) · Poisson 95% interval λ ± 1.96·√λ',
    value: expected === null ? '—' : expected.toFixed(1),
    target: expected === null ? undefined : (lower !== null && upper !== null ? `95% PI ${lower.toFixed(1)}–${upper.toFixed(1)}` : undefined),
    stats: [{ label: 'Months of history', value: String(months) }],
    narrative: 'Recordables are rare events, so the forecast uses a Poisson interval (asymmetric, never negative) and the distribution is shown as a c-chart / Poisson fit rather than a bell curve. Treat this as indicative of direction, not a guaranteed compliance outcome — widen your guard early in a window when the count is small.',
    href: '/incidents',
    hrefLabel: 'Incidents',
    tone: 'neutral',
  }
}
