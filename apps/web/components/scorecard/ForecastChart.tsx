'use client'

import {
  ResponsiveContainer, ComposedChart, Area, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { CountForecast } from '@soteria/core/forecast'
import { CHART, AXIS_TICK, TOOLTIP_STYLE } from './chartTheme'

// "Where things are going" — actuals as a solid line, the next-period
// projection as a dashed continuation, and the Poisson 95% prediction interval
// as a shaded band. A "now" reference line marks the actual/forecast boundary.
// The forecast itself comes from the deterministic core (forecastCount); this
// component only draws it.

const round1 = (n: number) => Math.round(n * 10) / 10

export function ForecastChart({ history, forecast, valueName = 'Recordables', projectionLabel = 'Next' }: {
  history: { label: string; value: number }[]
  forecast: CountForecast
  valueName?: string
  projectionLabel?: string
}) {
  type Point = { label: string; actual: number | null; projected: number | null; band?: [number, number] }
  const data: Point[] = history.map(h => ({ label: h.label, actual: h.value, projected: null }))
  if (data.length > 0) {
    const last = data[data.length - 1]!
    last.projected = last.actual         // connect the dashed projection to the last actual
    last.band = [last.actual!, last.actual!]
    data.push({
      label: projectionLabel,
      actual: null,
      projected: round1(forecast.expected),
      band: [round1(forecast.lower), round1(forecast.upper)],
    })
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" stroke={CHART.axis} tick={AXIS_TICK} />
        <YAxis allowDecimals={false} stroke={CHART.axis} tick={AXIS_TICK} />
        <Tooltip wrapperStyle={TOOLTIP_STYLE} />
        <Area dataKey="band" stroke="none" fill={CHART.blue} fillOpacity={0.12} name="95% interval" connectNulls isAnimationActive={false} />
        <Line dataKey="actual" stroke={CHART.rose} strokeWidth={2.5} dot={{ r: 2 }} name={valueName} connectNulls />
        <Line dataKey="projected" stroke={CHART.blue} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 3 }} name="Projected" connectNulls />
        {history.length > 0 && (
          <ReferenceLine x={history[history.length - 1]!.label} stroke={CHART.axis} strokeDasharray="2 2"
            label={{ value: 'now', fontSize: 9, fill: CHART.axis, position: 'top' }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
