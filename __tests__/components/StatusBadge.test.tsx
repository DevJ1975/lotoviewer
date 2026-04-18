import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '@/components/StatusBadge'

describe('StatusBadge', () => {
  it('renders "Complete" for complete status', () => {
    render(<StatusBadge status="complete" />)
    expect(screen.getByText('Complete')).toBeInTheDocument()
  })

  it('renders "Partial" for partial status', () => {
    render(<StatusBadge status="partial" />)
    expect(screen.getByText('Partial')).toBeInTheDocument()
  })

  it('renders "Missing" for missing status', () => {
    render(<StatusBadge status="missing" />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('applies green class for complete', () => {
    const { container } = render(<StatusBadge status="complete" />)
    expect(container.firstChild).toHaveClass('bg-green-100')
  })

  it('applies amber class for partial', () => {
    const { container } = render(<StatusBadge status="partial" />)
    expect(container.firstChild).toHaveClass('bg-amber-100')
  })

  it('applies red class for missing', () => {
    const { container } = render(<StatusBadge status="missing" />)
    expect(container.firstChild).toHaveClass('bg-red-100')
  })
})
