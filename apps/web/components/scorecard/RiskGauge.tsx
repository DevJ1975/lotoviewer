'use client'

import { RadialBarChart, RadialBar, PolarAngleAxis, ResponsiveContainer } from 'recharts'
import type { IncidentRiskBand } from '@soteria/core/incidentRiskModel'
import { RISK_BAND_FILL } from './chartTheme'

// Semicircular gauge for the 0–100 predicted-incident-risk score. A graphical
// companion to the numeric score in PredictedRiskCard; colored by band. Built on
// Recharts RadialBarChart (a fixed 0–100 PolarAngleAxis domain maps the score to
// arc fill) so it stays consistent with the rest of the scorecard's charts.

const BAND_LABEL: Record<IncidentRiskBand, string> = {
  low: 'Low', moderate: 'Moderate', high: 'High', extreme: 'Extreme',
}

export function RiskGauge({ score, band, size = 132 }: {
  score: number
  band: IncidentRiskBand
  size?: number
}) {
  const clamped = Math.max(0, Math.min(100, score))
  const fill = RISK_BAND_FILL[band]
  const data = [{ name: 'risk', value: clamped, fill }]

  return (
    <div className="relative" style={{ width: size, height: size / 2 + 16 }} aria-hidden="true">
      <ResponsiveContainer width="100%" height={size}>
        <RadialBarChart
          innerRadius="78%"
          outerRadius="100%"
          barSize={12}
          data={data}
          startAngle={180}
          endAngle={0}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar
            background={{ fill: 'rgba(148, 163, 184, 0.22)' }}
            dataKey="value"
            cornerRadius={6}
            angleAxisId={0}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      {/* Center label overlaps the semicircle's hollow. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
        <span className="text-3xl font-black leading-none tabular-nums text-slate-900 dark:text-slate-50">
          {Math.round(clamped)}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: fill }}>
          {BAND_LABEL[band]}
        </span>
      </div>
    </div>
  )
}
