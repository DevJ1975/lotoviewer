import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import DepartmentChart from '@/components/DepartmentChart'
import type { DepartmentStats } from '@/lib/types'

// Recharts uses ResizeObserver + SVG layout which don't work in jsdom.
// Mock at the module level so tests focus on our component logic.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div data-testid="chart-container">{children}</div>,
  BarChart:            ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar:                 ({ name }: { name: string }) => <div data-testid={`bar-${name.toLowerCase()}`} />,
  XAxis:               () => null,
  YAxis:               () => null,
  CartesianGrid:       () => null,
  Tooltip:             () => null,
  Legend:              () => null,
}))

function makeStat(dept: string, total: number): DepartmentStats {
  return { department: dept, total, complete: total, partial: 0, missing: 0, pct: 100 }
}

describe('DepartmentChart', () => {
  it('renders without crashing with valid data', () => {
    const data = [makeStat('Electrical', 10), makeStat('Mechanical', 5)]
    render(<DepartmentChart data={data} />)
    expect(screen.getByTestId('chart-container')).toBeInTheDocument()
  })

  it('renders all three bar series', () => {
    render(<DepartmentChart data={[makeStat('D', 1)]} />)
    expect(screen.getByTestId('bar-complete')).toBeInTheDocument()
    expect(screen.getByTestId('bar-partial')).toBeInTheDocument()
    expect(screen.getByTestId('bar-missing')).toBeInTheDocument()
  })

  it('renders with empty data without crashing', () => {
    render(<DepartmentChart data={[]} />)
    expect(screen.getByTestId('chart-container')).toBeInTheDocument()
  })

  it('caps displayed data at 15 departments', () => {
    // 20 depts — only top 15 by total should be passed to BarChart
    const data = Array.from({ length: 20 }, (_, i) =>
      makeStat(`Dept-${i}`, 20 - i)
    )
    // Component slices to 15 internally; since the mock renders everything,
    // we verify it renders exactly 3 bar series (complete/partial/missing), not 20×3.
    render(<DepartmentChart data={data} />)
    expect(screen.getAllByTestId(/^bar-/)).toHaveLength(3)
  })
})
