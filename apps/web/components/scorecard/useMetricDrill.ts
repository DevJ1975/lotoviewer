'use client'

import { useCallback, useState } from 'react'
import type { MetricDetail } from './metricDetail'

// Tiny state holder for the Tableau-style drill-down. The page renders one
// <MetricDetailSheet> bound to this hook; every tappable graphic calls open(...)
// with its MetricDetail. Kept as a hook (not context) because the scorecard is a
// single page — no cross-tree sharing needed (KISS).

export interface MetricDrill {
  selected: MetricDetail | null
  open: (detail: MetricDetail) => void
  close: () => void
}

export function useMetricDrill(): MetricDrill {
  const [selected, setSelected] = useState<MetricDetail | null>(null)
  const open = useCallback((detail: MetricDetail) => setSelected(detail), [])
  const close = useCallback(() => setSelected(null), [])
  return { selected, open, close }
}
