import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { manifestReturnClock, type ManifestStatus } from '@soteria/core/hazardousWasteManifest'
import type { ManifestListItem } from '@/lib/hazardousWasteManifestView'

// The manifest list: each shipment with the stage of its return clock, the filters, and what the
// screen says when there is nothing to show or the request fails.

const listManifests = vi.fn()
vi.mock('@/app/hazardous-waste/manifests/_lib/manifestClient', async () => {
  const actual = await vi.importActual<typeof import('@/app/hazardous-waste/manifests/_lib/manifestClient')>('@/app/hazardous-waste/manifests/_lib/manifestClient')
  return { ...actual, listManifests: (...a: unknown[]) => listManifests(...a) }
})
// A stable object, as the real hook returns: a new one every render would re-run the load effect.
const TENANT = { tenant: { id: 'tenant-1' }, tenantId: 'tenant-1' }
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => TENANT }))

import HazardousWasteManifestsPage from '@/app/hazardous-waste/manifests/page'

const NOW = new Date('2026-04-06T12:00:00Z')

function item(over: Partial<ManifestListItem> & { id: string }): ManifestListItem {
  const base = {
    tenant_id: 'tenant-1', facility_id: 'site-1', manifest_tracking_number: '123456789ELC', status: 'shipped' as ManifestStatus, jurisdiction: 'federal' as const,
    generator_category: 'lqg' as const, generator_epa_id: null, transporter_epa_id: null, tsdf_epa_id: null, transporter_name: null, tsdf_name: null,
    waste_codes: [], dot_description: null, electronic: false, shipped_on: '2026-03-01', completed_on: null, exception_reported_on: null,
    notes: null, created_by: 'user-1', created_at: '2026-03-01T09:00:00Z', updated_at: '2026-03-01T09:00:00Z',
    containers: [{ id: 'c1', label: 'Drum 1', status: 'in_shipment' as const }],
  }
  const merged = { ...base, ...over }
  return {
    ...merged,
    clock: over.clock ?? manifestReturnClock({
      generatorCategory: merged.generator_category, jurisdiction: merged.jurisdiction, status: merged.status,
      shippedOn: merged.shipped_on, completedOn: merged.completed_on, exceptionReportedOn: merged.exception_reported_on, now: NOW,
    }),
  }
}

const page = (manifests: ManifestListItem[], over: { total?: number; nextOffset?: number | null } = {}) =>
  ({ manifests, total: over.total ?? manifests.length, nextOffset: over.nextOffset ?? null })

beforeEach(() => {
  listManifests.mockReset()
})

describe('the list', () => {
  it('shows each manifest with its tracking number, status, container labels and clock chip', async () => {
    listManifests.mockResolvedValue(page([
      item({ id: 'm1', shipped_on: '2026-03-01', transporter_name: 'Haul Co', tsdf_name: 'Burn Inc',
        containers: ['Drum 1', 'Drum 2', 'Drum 3', 'Drum 4', 'Drum 5'].map((label, i) => ({ id: `c${i}`, label, status: 'in_shipment' as const })) }),
    ]))
    render(<HazardousWasteManifestsPage />)

    const row = within(await screen.findByRole('listitem'))
    expect(row.getByRole('link', { name: '123456789ELC' })).toHaveAttribute('href', '/hazardous-waste/manifests/m1')
    expect(row.getByText('Day 36 of 45 · Follow up now')).toBeInTheDocument()
    expect(row.getByText('Shipped')).toBeInTheDocument()
    expect(row.getByText(/5 containers: Drum 1, Drum 2, Drum 3 and 2 more/)).toBeInTheDocument()
    expect(row.getByText('Transporter: Haul Co')).toBeInTheDocument()
    expect(row.getByText('To: Burn Inc')).toBeInTheDocument()
    expect(row.getByText('Exception report by Apr 15, 2026')).toBeInTheDocument()
  })

  it('calls a draft a draft, without a tracking number, and shows no clock for it', async () => {
    listManifests.mockResolvedValue(page([item({ id: 'm2', status: 'draft', manifest_tracking_number: null, shipped_on: null })]))
    render(<HazardousWasteManifestsPage />)
    const row = within(await screen.findByRole('listitem'))
    expect(row.getByRole('link', { name: /Draft, no tracking number yet/ })).toBeInTheDocument()
    expect(row.getAllByText('Draft')).toHaveLength(2)   // the stage chip and the status
    expect(row.queryByText(/Day \d+ of/)).not.toBeInTheDocument()
  })

  it('says how many are waiting on an exception report or a follow-up', async () => {
    listManifests.mockResolvedValue(page([
      item({ id: 'a', shipped_on: '2026-02-01' }),   // day 64: exception report due
      item({ id: 'b', shipped_on: '2026-02-01' }),
      item({ id: 'c', shipped_on: '2026-03-01' }),   // day 36: follow up
      item({ id: 'd', shipped_on: '2026-04-01' }),   // day 5: on track
    ]))
    render(<HazardousWasteManifestsPage />)
    expect(await screen.findByText('2 exception reports due')).toBeInTheDocument()
    expect(screen.getByText('1 to follow up')).toBeInTheDocument()
  })

  it('says nothing about deadlines when none is pressing', async () => {
    listManifests.mockResolvedValue(page([item({ id: 'd', shipped_on: '2026-04-01' })]))
    render(<HazardousWasteManifestsPage />)
    await screen.findByRole('listitem')
    expect(screen.queryByText(/due$/)).not.toBeInTheDocument()
    expect(screen.queryByText(/to follow up/)).not.toBeInTheDocument()
  })

  it('asks for every manifest but the cancelled by default', async () => {
    listManifests.mockResolvedValue(page([]))
    render(<HazardousWasteManifestsPage />)
    await screen.findByText(/No manifests yet/)
    expect(listManifests).toHaveBeenCalledWith('tenant-1', { status: undefined, offset: 0 })
    expect(screen.getByRole('button', { name: 'All but cancelled' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('links to a new manifest', async () => {
    listManifests.mockResolvedValue(page([]))
    render(<HazardousWasteManifestsPage />)
    expect(await screen.findByRole('link', { name: /New manifest/ })).toHaveAttribute('href', '/hazardous-waste/manifests/new')
  })
})

describe('empty and error states', () => {
  it('invites the first manifest when there are none, with a link to start it', async () => {
    listManifests.mockResolvedValue(page([]))
    render(<HazardousWasteManifestsPage />)
    expect(await screen.findByText(/No manifests yet/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'start the first manifest' })).toHaveAttribute('href', '/hazardous-waste/manifests/new')
  })

  it('says which status has none when a filter comes up empty', async () => {
    const user = userEvent.setup()
    listManifests.mockResolvedValueOnce(page([item({ id: 'm1' })])).mockResolvedValueOnce(page([]))
    render(<HazardousWasteManifestsPage />)
    await screen.findByRole('listitem')

    await user.click(screen.getByRole('button', { name: 'Cancelled' }))

    expect(await screen.findByText('No cancelled manifests.')).toBeInTheDocument()
    expect(listManifests).toHaveBeenLastCalledWith('tenant-1', { status: 'cancelled', offset: 0 })
    expect(screen.getByRole('button', { name: 'Cancelled' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All but cancelled' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the error in an alert, and does not claim there are no manifests', async () => {
    listManifests.mockRejectedValue(new Error('Module is not enabled for this tenant'))
    render(<HazardousWasteManifestsPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Module is not enabled for this tenant')
    expect(screen.queryByText(/No manifests yet/)).not.toBeInTheDocument()
  })

  it('shows a loading state until the list arrives', async () => {
    let resolve: (value: unknown) => void = () => {}
    listManifests.mockReturnValue(new Promise(r => { resolve = r }))
    render(<HazardousWasteManifestsPage />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    resolve(page([item({ id: 'm1' })]))
    await screen.findByRole('listitem')
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
  })
})

describe('filters and paging', () => {
  it('offers a filter for every status, as buttons that say which is pressed', async () => {
    listManifests.mockResolvedValue(page([]))
    render(<HazardousWasteManifestsPage />)
    const group = await screen.findByRole('group', { name: 'Filter by status' })
    expect(within(group).getAllByRole('button').map(b => b.textContent)).toEqual([
      'All but cancelled', 'Draft', 'Shipped', 'Completed', 'Exception reported', 'Cancelled',
    ])
  })

  it('asks for the status chosen, from the first page', async () => {
    const user = userEvent.setup()
    listManifests.mockResolvedValue(page([]))
    render(<HazardousWasteManifestsPage />)
    await screen.findByText(/No manifests yet/)
    await user.click(screen.getByRole('button', { name: 'Shipped' }))
    await waitFor(() => expect(listManifests).toHaveBeenLastCalledWith('tenant-1', { status: 'shipped', offset: 0 }))
  })

  it('loads the next page and adds it to the list', async () => {
    const user = userEvent.setup()
    listManifests
      .mockResolvedValueOnce(page([item({ id: 'm1', manifest_tracking_number: '111111111AAA' })], { total: 2, nextOffset: 1 }))
      .mockResolvedValueOnce(page([item({ id: 'm2', manifest_tracking_number: '222222222BBB' })], { total: 2, nextOffset: null }))
    render(<HazardousWasteManifestsPage />)
    await screen.findByText('Showing 1 of 2')

    await user.click(screen.getByRole('button', { name: 'Load more' }))

    await screen.findByText('Showing 2 of 2')
    expect(listManifests).toHaveBeenLastCalledWith('tenant-1', { status: undefined, offset: 1 })
    expect(screen.getAllByRole('listitem').map(li => within(li).getByRole('link').textContent)).toEqual(['111111111AAA', '222222222BBB'])
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })
})
