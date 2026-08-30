'use client'

import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'
import { mean, poissonPmf } from '@soteria/core/statistics'
import { CHART, AXIS_TICK, TOOLTIP_STYLE } from './chartTheme'

// The statistically honest "distribution" for rare counts: the observed
// frequency of monthly counts (how many months had 0, 1, 2, … recordables)
// against the fitted Poisson PMF. This is deliberately NOT a Gaussian bell —
// recordables are rare events, so a normal curve would imply impossible
// negative counts. The closeness of the bars to the line shows whether the
// process behaves like a stable Poisson stream.

export function DistributionChart({ counts, valueName = 'recordables' }: {
  counts: number[]
  valueName?: string
}) {
  const lambda = mean(counts) ?? 0
  const n = counts.length
  const maxK = Math.max(...counts, Math.ceil(lambda + 3 * Math.sqrt(lambda)), 1)
  const data = []
  for (let k = 0; k <= maxK; k++) {
    data.push({
      k,
      observed: counts.filter(c => c === k).length,
      expected: Math.round(poissonPmf(k, lambda) * n * 10) / 10,
    })
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="k" stroke={CHART.axis} tick={AXIS_TICK}
          label={{ value: `${valueName} per month`, position: 'insideBottom', offset: -2, fontSize: 9, fill: CHART.axis }} />
        <YAxis allowDecimals={false} stroke={CHART.axis} tick={AXIS_TICK} />
        <Tooltip wrapperStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 10 }} />
        <Bar dataKey="observed" name="Months observed" fill={CHART.navy} radius={[3, 3, 0, 0]} />
        <Line dataKey="expected" name={`Poisson (λ=${lambda.toFixed(1)})`} stroke={CHART.amber} strokeWidth={2} dot={{ r: 2 }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
