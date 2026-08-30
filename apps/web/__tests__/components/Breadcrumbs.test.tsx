import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

import { Breadcrumbs } from '@/components/Breadcrumbs'

const mockPathname = vi.fn<() => string | null>()
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
}))

describe('Breadcrumbs', () => {
  beforeEach(() => mockPathname.mockReset())

  it('renders no landmark at all on a module home', () => {
    mockPathname.mockReturnValue('/incidents')
    const { container } = render(<Breadcrumbs />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders no landmark when the pathname is unavailable', () => {
    mockPathname.mockReturnValue(null)
    const { container } = render(<Breadcrumbs />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels the navigation landmark so it is distinguishable from the drawer', () => {
    mockPathname.mockReturnValue('/admin/people/contractors/abc')
    render(<Breadcrumbs />)
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument()
  })

  it('links the crumbs that are real pages', () => {
    mockPathname.mockReturnValue('/admin/people/contractors/abc')
    render(<Breadcrumbs />)
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/admin')
    expect(screen.getByRole('link', { name: 'Contractors' }))
      .toHaveAttribute('href', '/admin/people/contractors')
  })

  // The section path 301s back to /admin, so a link here would send the user
  // further up than the crumb they clicked.
  it('renders the admin section as text, never a link', () => {
    mockPathname.mockReturnValue('/admin/people/contractors/abc')
    render(<Breadcrumbs />)
    expect(screen.getByText('People & Access')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'People & Access' })).not.toBeInTheDocument()
  })

  it('does not repeat the current page, which PageHeader already titles', () => {
    mockPathname.mockReturnValue('/incidents/new')
    render(<Breadcrumbs />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('link', { name: 'Incident Reporting' })).toBeInTheDocument()
  })
})
