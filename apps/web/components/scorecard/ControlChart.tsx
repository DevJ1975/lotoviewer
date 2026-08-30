'use client'

import {
  ResponsiveContainer, ComposedChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts'
import type { ControlLimits } from '@soteria/core/forecast'
import { CHART, AXIS_TICK, TOOLTIP_STYLE } from './chartTheme'

// c-chart (Shewhart control chart for counts) — the safety profession's
// standard for monthly recordable/near-miss counts, and the honest alternative
// to a Gaussian histogram for rare events. The center line is the mean count;
// points above the upper control limit (mean + 3√mean) signal variation worth
// investigating and are drawn larger and in red.

interface DotProps { cx?: number; cy?: number; value?: number; index?: number }

export function ControlChart({ data, limits, valueName = 'Count' }: {
  data: { label: string; value: number }[]
  limits: ControlLimits
  valueName?: string
}) {
  const renderDot = (props: DotProps) => {
    const { cx, cy, value, index } = props
    if (cx === undefined || cy === undefined) return <g key={index} />
    const outOfControl = (value ?? 0) > limits.ucl
    return (
      <circle key={index} cx={cx} cy={cy} r={outOfControl ? 4.5 : 2.5}
        fill={outOfControl ? CHART.rose : CHART.navy} stroke="#fff" strokeWidth={1} />
    )
  }

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={data} margin={{ top: 14, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART.grid} vertical={false} />
        <XAxis dataKey="label" stroke={CHART.axis} tick={AXIS_TICK} />
        <YAxis allowDecimals={false} stroke={CHART.axis} tick={AXIS_TICK} />
        <Tooltip wrapperStyle={TOOLTIP_STYLE} />
        <ReferenceLine y={limits.ucl} stroke={CHART.rose} strokeDasharray="4 2"
          label={{ value: `UCL ${limits.ucl.toFixed(1)}`, fontSize: 9, fill: CHART.rose, position: 'right' }} />
        <ReferenceLine y={limits.centerLine} stroke={CHART.axis} strokeDasharray="2 2"
          label={{ value: `CL ${limits.centerLine.toFixed(1)}`, fontSize: 9, fill: CHART.axis, position: 'right' }} />
        {limits.lcl > 0 && (
          <ReferenceLine y={limits.lcl} stroke={CHART.emerald} strokeDasharray="4 2"
            label={{ value: `LCL ${limits.lcl.toFixed(1)}`, fontSize: 9, fill: CHART.emerald, position: 'right' }} />
        )}
        <Line dataKey="value" stroke={CHART.navy} strokeWidth={2} name={valueName} dot={renderDot} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
