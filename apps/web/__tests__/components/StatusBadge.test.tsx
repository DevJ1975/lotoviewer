import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatusBadge from '@/components/StatusBadge'

// The badge now uses the safety-tag vocabulary (see globals.css):
//   complete → "Cleared"  (safety-tag-cleared)
//   partial  → "Partial"  (safety-tag-caution)
//   missing  → "Missing"  (safety-tag-danger)
// "Cleared" is the field-standard term for a piece of equipment whose
// placard evidence is verified end-to-end.

describe('StatusBadge', () => {
  it('renders "Cleared" for complete status', () => {
    render(<StatusBadge status="complete" />)
    expect(screen.getByText('Cleared')).toBeInTheDocument()
  })

  it('renders "Partial" for partial status', () => {
    render(<StatusBadge status="partial" />)
    expect(screen.getByText('Partial')).toBeInTheDocument()
  })

  it('renders "Missing" for missing status', () => {
    render(<StatusBadge status="missing" />)
    expect(screen.getByText('Missing')).toBeInTheDocument()
  })

  it('applies cleared tag class for complete', () => {
    const { container } = render(<StatusBadge status="complete" />)
    expect(container.firstChild).toHaveClass('safety-tag-cleared')
  })

  it('applies caution tag class for partial', () => {
    const { container } = render(<StatusBadge status="partial" />)
    expect(container.firstChild).toHaveClass('safety-tag-caution')
  })

  it('applies danger tag class for missing', () => {
    const { container } = render(<StatusBadge status="missing" />)
    expect(container.firstChild).toHaveClass('safety-tag-danger')
  })
})
