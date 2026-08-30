import { describe, it, expect } from 'vitest'
import {
  buildMonthOverMonthRow,
  closedMonthSeries,
  formatComparedMonths,
  MOM_MIN_COMBINED,
  MOM_MIN_HISTORY,
  type MonthCount,
} from '../monthOverMonth'

// 2026-07-29T12:00:00Z — mid-month, so the current month is partial.
const NOW = Date.UTC(2026, 6, 29, 12, 0, 0)

/** Build a dense ascending series ending at the given month. */
function series(counts: number[], endYear = 2026, endMonth = 5): MonthCount[] {
  // endMonth is 0-indexed; default June 2026 (the last closed month at NOW).
  return counts.map((count, i) => {
    const d = new Date(Date.UTC(endYear, endMonth - (counts.length - 1 - i), 1))
    return { month: d.toISOString().slice(0, 7), count }
  })
}

describe('closedMonthSeries', () => {
  it('excludes the current partial month', () => {
    const rows = [
      { at: '2026-07-15T00:00:00Z' }, // current month — must be dropped
      { at: '2026-06-15T00:00:00Z' },
    ]
    const out = closedMonthSeries(rows, r => r.at, NOW, 3)
    expect(out.map(b => b.month)).toEqual(['2026-04', '2026-05', '2026-06'])
    expect(out.find(b => b.month === '2026-06')?.count).toBe(1)
    expect(out.some(b => b.month === '2026-07')).toBe(false)
  })

  it('returns a dense series with zero-filled gaps', () => {
    const out = closedMonthSeries([], () => null, NOW, 4)
    expect(out).toEqual([
      { month: '2026-03', count: 0 },
      { month: '2026-04', count: 0 },
      { month: '2026-05', count: 0 },
      { month: '2026-06', count: 0 },
    ])
  })

  it('ignores unparseable, null and out-of-range timestamps', () => {
    const rows = [
      { at: 'not-a-date' },
      { at: null },
      { at: undefined },
      { at: '2019-01-01T00:00:00Z' }, // older than the window
      { at: '2026-06-01T00:00:00Z' }, // first instant of a closed month — counted
    ]
    const out = closedMonthSeries(rows, r => r.at as string | null, NOW, 3)
    expect(out.reduce((s, b) => s + b.count, 0)).toBe(1)
    expect(out.find(b => b.month === '2026-06')?.count).toBe(1)
  })

  it('handles a February leap month and a year boundary', () => {
    const leapNow = Date.UTC(2024, 2, 10) // 10 Mar 2024
    const rows = [
      { at: '2024-02-29T23:59:59Z' },
      { at: '2023-12-31T23:59:59Z' },
    ]
    const out = closedMonthSeries(rows, r => r.at, leapNow, 4)
    expect(out.map(b => b.month)).toEqual(['2023-11', '2023-12', '2024-01', '2024-02'])
    expect(out.find(b => b.month === '2024-02')?.count).toBe(1)
    expect(out.find(b => b.month === '2023-12')?.count).toBe(1)
  })

  it('returns nothing for a non-positive month count', () => {
    expect(closedMonthSeries([{ at: '2026-06-01T00:00:00Z' }], r => r.at, NOW, 0)).toEqual([])
  })
})

describe('buildMonthOverMonthRow — suppression', () => {
  const base = { key: 'k', label: 'L', higherIsBetter: false as boolean | null }

  it('suppresses when there is no comparison month', () => {
    const row = buildMonthOverMonthRow({ ...base, series: series([7]) })
    expect(row.suppressed).toBe('no_comparison_month')
    expect(row.significant).toBe(false)
    expect(row.currentMonth).toBeNull()
  })

  it('suppresses when combined events are below the floor, but still shows counts', () => {
    const row = buildMonthOverMonthRow({ ...base, series: series([0, 0, 0, 0, 0, 1, 4]) })
    expect(row.current + row.previous).toBeLessThan(MOM_MIN_COMBINED)
    expect(row.suppressed).toBe('insufficient_events')
    expect(row.significant).toBe(false)
    expect(row.tone).toBe('neutral')
    // The counts are still reported — suppression withholds the verdict, not the data.
    expect(row.current).toBe(4)
    expect(row.previous).toBe(1)
  })

  it('suppresses when history is shorter than the minimum, even with enough events', () => {
    const s = series([20, 20, 20])
    expect(s.length).toBeLessThan(MOM_MIN_HISTORY)
    const row = buildMonthOverMonthRow({ ...base, series: s })
    expect(row.suppressed).toBe('insufficient_history')
    expect(row.significant).toBe(false)
  })

  it('a zero-activity previous month does not throw and yields no percentage', () => {
    const row = buildMonthOverMonthRow({ ...base, series: series([5, 5, 5, 5, 5, 0, 12]) })
    expect(row.previous).toBe(0)
    expect(row.deltaPct).toBeNull()
    expect(row.direction).toBe('up')
  })

  it('suppresses the percentage on a small baseline', () => {
    const row = buildMonthOverMonthRow({ ...base, series: series([5, 5, 5, 5, 5, 4, 8]) })
    expect(row.previous).toBe(4)
    expect(row.deltaPct).toBeNull()
  })
})

describe('buildMonthOverMonthRow — c-chart gate', () => {
  const base = { key: 'k', label: 'L', higherIsBetter: false as boolean | null }

  it('flags a month outside the control limits built from prior months', () => {
    // Stable at ~5, then a spike well beyond UCL = 5 + 3*sqrt(5) ≈ 11.7.
    const row = buildMonthOverMonthRow({ ...base, series: series([5, 5, 5, 5, 5, 5, 30]) })
    expect(row.suppressed).toBeNull()
    expect(row.significant).toBe(true)
    expect(row.tone).toBe('bad') // higherIsBetter false, direction up
  })

  it('does not flag a month inside the limits', () => {
    const row = buildMonthOverMonthRow({ ...base, series: series([5, 6, 5, 7, 5, 6, 7]) })
    expect(row.suppressed).toBeNull()
    expect(row.significant).toBe(false)
    expect(row.tone).toBe('neutral')
  })

  it('builds limits from the PRIOR months only, so a spike cannot widen its own limits', () => {
    const withSpike = buildMonthOverMonthRow({ ...base, series: series([5, 5, 5, 5, 5, 5, 30]) })
    // If the spike were included in its own limits, cBar would rise enough to
    // swallow it. Excluding it keeps the month detectable.
    expect(withSpike.significant).toBe(true)
  })

  it('assigns tone by direction and higherIsBetter', () => {
    const up = series([5, 5, 5, 5, 5, 5, 30])
    expect(buildMonthOverMonthRow({ ...base, higherIsBetter: true, series: up }).tone).toBe('good')
    expect(buildMonthOverMonthRow({ ...base, higherIsBetter: false, series: up }).tone).toBe('bad')
    expect(buildMonthOverMonthRow({ ...base, higherIsBetter: null, series: up }).tone).toBe('neutral')
  })

  it('is monotone: a larger relative move is never judged less significant than a smaller one', () => {
    // The defect this gate replaces: |c-p| >= sqrt(c+p) calls 0 -> 1
    // significant but not 1 -> 2 or 2 -> 4, both doublings. Walk a rising
    // current month against a fixed stable history and assert that once a
    // value is flagged, every larger value is too.
    const history = [6, 6, 6, 6, 6, 6]
    let firstFlagged: number | null = null
    for (let current = 0; current <= 40; current += 1) {
      const row = buildMonthOverMonthRow({ ...base, series: series([...history, current]) })
      if (row.significant && current > 6) {
        if (firstFlagged === null) firstFlagged = current
      }
      if (firstFlagged !== null && current >= firstFlagged) {
        expect(row.significant).toBe(true)
      }
    }
    expect(firstFlagged).not.toBeNull()
  })
})

describe('formatComparedMonths', () => {
  it('renders a short month pair', () => {
    const row = buildMonthOverMonthRow({
      key: 'k', label: 'L', higherIsBetter: false, series: series([5, 5, 5, 5, 5, 5, 7]),
    })
    expect(formatComparedMonths(row)).toBe('Jun vs May')
  })

  it('returns null when there is nothing to compare', () => {
    const row = buildMonthOverMonthRow({
      key: 'k', label: 'L', higherIsBetter: false, series: [],
    })
    expect(formatComparedMonths(row)).toBeNull()
  })
})
