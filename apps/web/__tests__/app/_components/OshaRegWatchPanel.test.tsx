import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import OshaRegWatchPanel from '@/app/_components/OshaRegWatchPanel'
import type { OshaRegulationUpdate } from '@soteria/core/oshaRegWatch'

// Mock useTenant rather than mounting the real provider (it does its own
// Supabase fetch). isModuleVisible runs for real against the features
// catalog, so toggling tenant.modules['osha-reg-watch'] exercises gating.
const mockUseTenant = vi.fn()
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => mockUseTenant(),
}))

// Override only the fetcher; keep sortUpdatesForFeed + types real.
const mockFetch = vi.fn()
vi.mock('@soteria/core/oshaRegWatch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@soteria/core/oshaRegWatch')>()
  return { ...actual, fetchOshaRegulationUpdates: (...args: unknown[]) => mockFetch(...args) }
})

function update(over: Partial<OshaRegulationUpdate> = {}): OshaRegulationUpdate {
  return {
    id:                 'u1',
    title:              'Walking-Working Surfaces Final Rule',
    category:           'final_rule',
    is_upcoming:        false,
    source_url:         'https://www.federalregister.gov/documents/2026/05/01/2026-12345/walking-working-surfaces',
    published_date:     '2026-05-01',
    effective_date:     null,
    comment_close_date: null,
    impact_summary:     'Employers must inspect walking surfaces and document repairs.',
    severity:           'high',
    fetched_at:         '2026-06-01T00:00:00Z',
    ...over,
  }
}

describe('OshaRegWatchPanel', () => {
  beforeEach(() => {
    mockUseTenant.mockReset()
    mockFetch.mockReset()
  })

  it('renders nothing when the tenant has the module turned off', () => {
    mockUseTenant.mockReturnValue({ tenant: { id: 't', modules: { 'osha-reg-watch': false } }, loading: false })
    const { container } = render(<OshaRegWatchPanel />)
    expect(container).toBeEmptyDOMElement()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('shows the empty state when there are no updates', async () => {
    mockUseTenant.mockReturnValue({ tenant: { id: 't', modules: {} }, loading: false })
    mockFetch.mockResolvedValue([])
    render(<OshaRegWatchPanel />)
    expect(await screen.findByText(/No OSHA regulatory updates yet/i)).toBeInTheDocument()
  })

  it('shows the empty state when the fetch returns null (swallowed query error)', async () => {
    mockUseTenant.mockReturnValue({ tenant: { id: 't', modules: {} }, loading: false })
    mockFetch.mockResolvedValue(null)
    render(<OshaRegWatchPanel />)
    expect(await screen.findByText(/No OSHA regulatory updates yet/i)).toBeInTheDocument()
  })

  it('renders an update as an external link with badge, summary, and date', async () => {
    mockUseTenant.mockReturnValue({ tenant: { id: 't', modules: {} }, loading: false })
    mockFetch.mockResolvedValue([update({ is_upcoming: true, comment_close_date: '2026-07-15' })])
    render(<OshaRegWatchPanel />)

    const link = await screen.findByRole('link', { name: /Walking-Working Surfaces/i })
    expect(link).toHaveAttribute('href', 'https://www.federalregister.gov/documents/2026/05/01/2026-12345/walking-working-surfaces')
    expect(link).toHaveAttribute('target', '_blank')
    expect(screen.getByText('Upcoming')).toBeInTheDocument()
    expect(screen.getByText(/Employers must inspect walking surfaces/i)).toBeInTheDocument()
    expect(screen.getByText(/Comments close/i)).toBeInTheDocument()
  })

  it('renders the title as plain text (no link) when no source URL is present', async () => {
    mockUseTenant.mockReturnValue({ tenant: { id: 't', modules: {} }, loading: false })
    mockFetch.mockResolvedValue([update({ source_url: '' })])
    render(<OshaRegWatchPanel />)
    expect(await screen.findByText('Walking-Working Surfaces Final Rule')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Walking-Working Surfaces/i })).not.toBeInTheDocument()
  })

  it('renders nothing when the fetch throws', async () => {
    mockUseTenant.mockReturnValue({ tenant: { id: 't', modules: {} }, loading: false })
    mockFetch.mockRejectedValue(new Error('boom'))
    const { container } = render(<OshaRegWatchPanel />)
    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
