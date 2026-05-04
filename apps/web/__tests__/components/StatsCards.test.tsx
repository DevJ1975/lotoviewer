import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatsCards from '@/components/StatsCards'

describe('StatsCards', () => {
  const defaultProps = { total: 701, complete: 247, partial: 89, missing: 365 }

  it('renders all four stat labels', () => {
    render(<StatsCards {...defaultProps} />)
    expect(screen.getByText('Total Equipment')).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.getByText('Partial')).toBeInTheDocument()
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('renders the correct numeric values', () => {
    render(<StatsCards {...defaultProps} />)
    expect(screen.getByText('701')).toBeInTheDocument()
    expect(screen.getByText('247')).toBeInTheDocument()
    expect(screen.getByText('89')).toBeInTheDocument()
    expect(screen.getByText('365')).toBeInTheDocument()
  })

  it('formats large numbers with locale separator', () => {
    render(<StatsCards total={1234} complete={0} partial={0} missing={0} />)
    // toLocaleString output depends on locale, but in en-US this is "1,234"
    expect(screen.getByText('1,234')).toBeInTheDocument()
  })

  it('renders zero values without error', () => {
    render(<StatsCards total={0} complete={0} partial={0} missing={0} />)
    expect(screen.getAllByText('0')).toHaveLength(4)
  })
})
