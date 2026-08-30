// Shared chart palette + axis/tooltip defaults for the EHS scorecard charts.
//
// These hex values were duplicated inline across the scorecard page's Recharts
// usage (navy bars, emerald near-miss, rose recordables, slate grid/axis). They
// are collected here so the new scorecard components (gauge, distribution,
// forecast, leading/lagging) render with one consistent vocabulary and a future
// theme tweak is a one-file change.

import type { IncidentRiskBand } from '@soteria/core/incidentRiskModel'

export const CHART = {
  navy:    '#1B3A6B',
  blue:    '#1D4ED8',
  teal:    '#0F766E',
  emerald: '#059669',
  amber:   '#D97706',
  orange:  '#C2410C',
  rose:    '#BE123C',
  slate:   '#cbd5e1',
  grid:    '#dbe3ee',
  axis:    '#64748b',
} as const

// Recharts axis tick props the scorecard charts share.
export const AXIS_TICK = { fontSize: 10, fill: CHART.axis } as const

// Recharts <Tooltip> defaults — small type, subtle hover cursor.
export const TOOLTIP_STYLE = { fontSize: 11 } as const

// Risk-band → fill, matching the page's RISK_BAND_STYLE bars but as raw hex so
// SVG charts (RadialBar, ReferenceLine) can consume them directly.
export const RISK_BAND_FILL: Record<IncidentRiskBand, string> = {
  low:      CHART.emerald,
  moderate: CHART.amber,
  high:     CHART.orange,
  extreme:  CHART.rose,
}
