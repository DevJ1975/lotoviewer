import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MANIFEST_ACTIONS, manifestReturnClock, manifestRetentionEnd, type ManifestStatus } from '@soteria/core/hazardousWasteManifest'
import { MANIFEST_ACTION_LABEL, todayLocal, type ManifestDetail } from '@/lib/hazardousWasteManifestView'

// A manifest's page: the clock, the moves its status allows (and only those), what each move does to
// the containers before it is made, and the draft's details.

const getManifest = vi.fn()
const transitionManifest = vi.fn()
const updateManifest = vi.fn()
vi.mock('@/app/hazardous-waste/manifests/_lib/manifestClient', async () => {
  const actual = await vi.importActual<typeof import('@/app/hazardous-waste/manifests/_lib/manifestClient')>('@/app/hazardous-waste/manifests/_lib/manifestClient')
  return {
    ...actual,
    getManifest: (...a: unknown[]) => getManifest(...a),
    transitionManifest: (...a: unknown[]) => transitionManifest(...a),
    updateManifest: (...a: unknown[]) => updateManifest(...a),
  }
})
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'm1' }) }))
const TENANT = { tenant: { id: 'tenant-1' }, tenantId: 'tenant-1' }
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => TENANT }))

import HazardousWasteManifestDetailPage from '@/app/hazardous-waste/manifests/[id]/page'
import { ManifestApiError } from '@/app/hazardous-waste/manifests/_lib/manifestClient'

const NOW = new Date('2026-04-06T12:00:00Z')

function manifest(over: Partial<ManifestDetail> = {}): ManifestDetail {
  const base = {
    id: 'm1', tenant_id: 'tenant-1', facility_id: 'site-1', manifest_tracking_number: '123456789ELC', status: 'draft' as ManifestStatus, jurisdiction: 'federal' as const,
    generator_category: 'lqg' as const, generator_epa_id: 'CAL000123456', transporter_epa_id: null, tsdf_epa_id: null, transporter_name: 'Haul Co', tsdf_name: 'Burn Inc',
    waste_codes: ['D001', 'F003'], dot_description: 'UN1993', electronic: false, shipped_on: null as string | null, completed_on: null as string | null,
    exception_reported_on: null as string | null, notes: 'Pickup booked', created_by: 'user-1', created_at: '2026-03-01T09:00:00Z', updated_at: '2026-03-01T09:00:00Z',
    containers: [
      { id: 'c1', label: 'Drum 1', status: 'in_shipment' as const, stream_name: 'Spent solvent' },
      { id: 'c2', label: 'Drum 2', status: 'in_shipment' as const, stream_name: 'Paint waste' },
    ],
    can_modify: true,
  }
  const merged = { ...base, ...over }
  return {
    ...merged,
    retention_end: manifestRetentionEnd(merged.shipped_on),
    clock: over.clock ?? manifestReturnClock({
      generatorCategory: merged.generator_category, jurisdiction: merged.jurisdiction, status: merged.status,
      shippedOn: merged.shipped_on, completedOn: merged.completed_on, exceptionReportedOn: merged.exception_reported_on, now: NOW,
    }),
  }
}
const SHIPPED = () => manifest({ status: 'shipped', shipped_on: '2026-03-01' })

beforeEach(() => {
  for (const fn of [getManifest, transitionManifest, updateManifest]) fn.mockReset()
})

const show = async (m: ManifestDetail) => {
  getManifest.mockResolvedValue({ manifest: m })
  render(<HazardousWasteManifestDetailPage />)
  await screen.findByRole('heading', { level: 1 })
}
const actionButtons = () => MANIFEST_ACTIONS.filter(a => screen.queryByRole('button', { name: MANIFEST_ACTION_LABEL[a] }))

describe('what the page shows', () => {
  it('shows the tracking number, status, clock stage and containers', async () => {
    await show(SHIPPED())
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('123456789ELC')
    expect(screen.getByText('Day 36 of 45 · Follow up now')).toBeInTheDocument()
    expect(getManifest).toHaveBeenCalledWith('tenant-1', 'm1')
    const containers = within(screen.getByRole('list', { name: 'Containers on this manifest' }))
    expect(containers.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      expect.stringContaining('Drum 1'), expect.stringContaining('Drum 2'),
    ])
    expect(containers.getAllByText('In shipment')).toHaveLength(2)
  })

  it('explains the clock: the dates owed and how long to keep the signed copy', async () => {
    await show(SHIPPED())
    const clock = screen.getByRole('heading', { name: 'Return clock' }).closest('section')!
    expect(within(clock).getByText(/No signed copy after 35 days/)).toBeInTheDocument()
    expect(within(clock).getByText('Apr 5, 2026')).toBeInTheDocument()       // follow-up
    expect(within(clock).getByText('Apr 15, 2026')).toBeInTheDocument()      // exception report
    expect(within(clock).getByText('Mar 1, 2029')).toBeInTheDocument()       // keep until
  })

  it('does not call a follow-up "not required" for an LQG whose clock has not started, but does for a small quantity generator', async () => {
    await show(manifest())
    const followUp = () => screen.getByText('Follow-up due').parentElement!
    expect(followUp()).toHaveTextContent('—')
    expect(followUp()).not.toHaveTextContent('Not required')
  })

  it('says no follow-up is required of a small quantity generator, who has only the 60-day report', async () => {
    await show(manifest({ status: 'shipped', shipped_on: '2026-03-01', generator_category: 'sqg' }))
    expect(screen.getByText('Follow-up due').parentElement!).toHaveTextContent('Not required')
    expect(screen.getByText('Day 36 of 60 · On track')).toBeInTheDocument()
    expect(screen.getByText('Apr 30, 2026')).toBeInTheDocument()
  })

  it('shows the timeline with the steps not yet taken marked as such', async () => {
    await show(SHIPPED())
    const timeline = within(screen.getByRole('list', { name: 'Manifest timeline' }))
    expect(timeline.getAllByRole('listitem').map(li => li.textContent)).toEqual([
      'DraftedMar 1, 2026', 'Shipped: transporter accepted the wasteMar 1, 2026', 'Signed copy receivedNot yet',
    ])
  })

  it('shows the details of the shipment', async () => {
    await show(SHIPPED())
    const details = screen.getByRole('heading', { name: 'Details' }).closest('section')!
    for (const text of ['LQG: large quantity generator', 'Federal (40 CFR)', 'CAL000123456', 'On paper', 'Haul Co', 'Burn Inc', 'D001, F003', 'UN1993', 'Pickup booked']) {
      expect(within(details).getByText(text)).toBeInTheDocument()
    }
  })

  it('calls a manifest with no number a draft manifest', async () => {
    await show(manifest({ manifest_tracking_number: null }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Draft manifest')
  })

  it('says a federal VSQG has no return clock rather than counting days', async () => {
    await show(manifest({ status: 'shipped', shipped_on: '2026-03-01', generator_category: 'vsqg' }))
    expect(screen.getAllByText('No return clock').length).toBeGreaterThan(0)
    expect(screen.queryByText(/Day \d+ of/)).not.toBeInTheDocument()
  })

  it('shows a not-found error in an alert, with no actions', async () => {
    getManifest.mockRejectedValue(new Error('Not found'))
    render(<HazardousWasteManifestDetailPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found')
    expect(actionButtons()).toEqual([])
  })
})

describe('only the moves the status allows are offered', () => {
  it.each([
    ['draft', ['ship', 'cancel']],
    ['shipped', ['receive', 'file_exception', 'cancel']],
    ['completed', []],
    ['exception_reported', []],
    ['cancelled', []],
  ] as const)('a %s manifest offers %j', async (status, expected) => {
    await show(manifest({ status, shipped_on: status === 'draft' ? null : '2026-03-01', completed_on: status === 'completed' ? '2026-03-20' : null, exception_reported_on: status === 'exception_reported' ? '2026-04-01' : null }))
    expect(actionButtons()).toEqual(expected)
  })

  it('says a finished manifest is finished', async () => {
    await show(manifest({ status: 'completed', shipped_on: '2026-03-01', completed_on: '2026-03-20' }))
    expect(screen.getByText(/This manifest is completed. Nothing more can be done to it/)).toBeInTheDocument()
  })

  it('offers nothing to someone who may not change it, and says who may', async () => {
    await show({ ...SHIPPED(), can_modify: false })
    expect(actionButtons()).toEqual([])
    expect(screen.getByText(/Only the person who drafted this manifest, or a tenant admin/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument()
  })
})

describe('making a move', () => {
  it('shows what shipping does to the containers before it is confirmed, and ships on the date given', async () => {
    const user = userEvent.setup()
    transitionManifest.mockResolvedValue({ manifest: SHIPPED() })
    await show(manifest())

    await user.click(screen.getByRole('button', { name: 'Ship' }))
    const form = screen.getByRole('form', { name: 'Ship' })
    expect(within(form).getByText(/The manifest becomes/)).toHaveTextContent('Shipped')
    expect(within(form).getByText(/The 2 containers stay In shipment/)).toBeInTheDocument()
    const date = within(form).getByLabelText('Date the transporter accepted the waste')
    expect(date).toHaveValue(todayLocal())
    expect(date).toHaveAttribute('max', todayLocal())
    await user.clear(date)
    await user.type(date, '2026-03-01')
    await user.type(within(form).getByLabelText('Note (optional)'), ' Driver signed ')
    await user.click(within(form).getByRole('button', { name: 'Confirm shipment' }))

    expect(transitionManifest).toHaveBeenCalledWith('tenant-1', 'm1', { action: 'ship', on: '2026-03-01', note: 'Driver signed' })
    expect(await screen.findByText(/Ship: done. The manifest is now shipped/)).toBeInTheDocument()
    expect(screen.getByText('Day 36 of 45 · Follow up now')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Ship' })).not.toBeInTheDocument()
    expect(actionButtons()).toEqual(['receive', 'file_exception', 'cancel'])
  })

  it('shows that recording the signed copy disposes of the containers', async () => {
    const user = userEvent.setup()
    transitionManifest.mockResolvedValue({ manifest: manifest({ status: 'completed', shipped_on: '2026-03-01', completed_on: '2026-03-20' }) })
    await show(SHIPPED())

    await user.click(screen.getByRole('button', { name: 'Record signed copy' }))
    const form = screen.getByRole('form', { name: 'Record signed copy' })
    expect(within(form).getByText(/The 2 containers become Disposed and leave the active container list/)).toBeInTheDocument()
    expect(within(form).getByText(/The manifest becomes/)).toHaveTextContent('Completed')
    await user.click(within(form).getByRole('button', { name: 'Confirm signed copy received' }))

    expect(transitionManifest).toHaveBeenCalledWith('tenant-1', 'm1', { action: 'receive', on: todayLocal(), note: null })
    expect(await screen.findByText(/now completed/)).toBeInTheDocument()
    expect(actionButtons()).toEqual([])
  })

  it('bounds the date by the ship date: a signed copy cannot come back before the waste left', async () => {
    const user = userEvent.setup()
    await show(SHIPPED())
    await user.click(screen.getByRole('button', { name: 'Record signed copy' }))
    expect(screen.getByLabelText('Date the signed copy was received')).toHaveAttribute('min', '2026-03-01')
  })

  it('shows that an exception report leaves the containers in shipment', async () => {
    const user = userEvent.setup()
    await show(SHIPPED())
    await user.click(screen.getByRole('button', { name: 'File exception report' }))
    const form = screen.getByRole('form', { name: 'File exception report' })
    expect(within(form).getByText(/The 2 containers stay In shipment/)).toBeInTheDocument()
    expect(within(form).getByLabelText('Date the exception report was filed')).toBeInTheDocument()
  })

  it('shows that cancelling puts the containers back, and asks for no date', async () => {
    const user = userEvent.setup()
    transitionManifest.mockResolvedValue({ manifest: manifest({ status: 'cancelled' }) })
    await show(manifest())

    await user.click(screen.getByRole('button', { name: 'Cancel manifest' }))
    const form = screen.getByRole('form', { name: 'Cancel manifest' })
    expect(within(form).getByText(/The 2 containers go back to Closed and can go on another manifest/)).toBeInTheDocument()
    expect(within(form).queryByLabelText(/Date/)).not.toBeInTheDocument()
    await user.click(within(form).getByRole('button', { name: 'Confirm cancellation' }))

    expect(transitionManifest).toHaveBeenCalledWith('tenant-1', 'm1', { action: 'cancel', on: null, note: null })
    expect(await screen.findByText(/now cancelled/)).toBeInTheDocument()
  })

  it('agrees with one container', async () => {
    const user = userEvent.setup()
    await show(manifest({ containers: [{ id: 'c1', label: 'Drum 1', status: 'in_shipment' }] }))
    await user.click(screen.getByRole('button', { name: 'Cancel manifest' }))
    expect(screen.getByText(/The 1 container goes back to Closed/)).toBeInTheDocument()
  })

  it('will not ship a draft with no tracking number, and says why', async () => {
    const user = userEvent.setup()
    await show(manifest({ manifest_tracking_number: null }))
    await user.click(screen.getByRole('button', { name: 'Ship' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Add the manifest tracking number')
    expect(screen.getByRole('button', { name: 'Confirm shipment' })).toBeDisabled()
  })

  it('can be backed out of without changing anything', async () => {
    const user = userEvent.setup()
    await show(manifest())
    await user.click(screen.getByRole('button', { name: 'Ship' }))
    await user.click(screen.getByRole('button', { name: 'Never mind' }))
    expect(screen.queryByRole('form', { name: 'Ship' })).not.toBeInTheDocument()
    expect(transitionManifest).not.toHaveBeenCalled()
  })

  it('opens one move at a time and says which is open', async () => {
    const user = userEvent.setup()
    await show(manifest())
    const ship = screen.getByRole('button', { name: 'Ship' })
    const cancel = screen.getByRole('button', { name: 'Cancel manifest' })
    await user.click(ship)
    expect(ship).toHaveAttribute('aria-expanded', 'true')
    await user.click(cancel)
    expect(ship).toHaveAttribute('aria-expanded', 'false')
    expect(cancel).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('form')).toHaveLength(1)
  })

  it('can be operated from the keyboard alone', async () => {
    const user = userEvent.setup()
    transitionManifest.mockResolvedValue({ manifest: SHIPPED() })
    await show(manifest())

    screen.getByRole('button', { name: 'Ship' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('form', { name: 'Ship' })).toBeInTheDocument()
    await user.click(screen.getByLabelText('Date the transporter accepted the waste'))
    await user.keyboard('{Enter}')

    expect(transitionManifest).toHaveBeenCalledTimes(1)
  })

  it('shows the refusal where the move was made, leaves the manifest as it was, and lets the person try again', async () => {
    const user = userEvent.setup()
    transitionManifest.mockRejectedValueOnce(new ManifestApiError('The ship date cannot be in the future.', 409)).mockResolvedValueOnce({ manifest: SHIPPED() })
    await show(manifest())
    await user.click(screen.getByRole('button', { name: 'Ship' }))
    const form = screen.getByRole('form', { name: 'Ship' })
    await user.click(within(form).getByRole('button', { name: 'Confirm shipment' }))

    expect(await within(form).findByRole('alert')).toHaveTextContent('The ship date cannot be in the future.')
    expect(screen.getByRole('form', { name: 'Ship' })).toBeInTheDocument()
    expect(actionButtons()).toEqual(['ship', 'cancel'])
    expect(screen.queryByText(/done/)).not.toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Confirm shipment' }))
    expect(await screen.findByText(/Ship: done/)).toBeInTheDocument()
  })
})

describe('editing a draft', () => {
  it('offers the edit on a draft only', async () => {
    await show(manifest())
    expect(screen.getByRole('button', { name: 'Edit details' })).toBeInTheDocument()
  })

  it.each(['shipped', 'completed', 'exception_reported', 'cancelled'] as const)('offers no edit once the manifest is %s', async status => {
    await show(manifest({ status, shipped_on: '2026-03-01' }))
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument()
  })

  it('shows the form with the draft\'s values, saves only through the API, and shows the result', async () => {
    const user = userEvent.setup()
    updateManifest.mockResolvedValue({ manifest: manifest({ transporter_name: 'New Haul Co' }) })
    await show(manifest())

    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    const transporter = screen.getByLabelText('Transporter name')
    expect(transporter).toHaveValue('Haul Co')
    expect(screen.getByLabelText('Manifest tracking number')).toHaveValue('123456789ELC')
    expect(screen.getByLabelText('Waste codes')).toHaveValue('D001, F003')
    await user.clear(transporter)
    await user.type(transporter, 'New Haul Co')
    await user.click(screen.getByRole('button', { name: 'Save details' }))

    expect(updateManifest).toHaveBeenCalledWith('tenant-1', 'm1', expect.objectContaining({
      transporter_name: 'New Haul Co', manifest_tracking_number: '123456789ELC', waste_codes: ['D001', 'F003'], generator_category: 'lqg', jurisdiction: 'federal',
    }))
    expect(await screen.findByText('Details saved.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('heading', { name: 'Details' }).closest('section')!).getByText('New Haul Co')).toBeInTheDocument()
  })

  it('shows the refusal beside the field it is about and stays in the form', async () => {
    const user = userEvent.setup()
    updateManifest.mockRejectedValue(new ManifestApiError('tsdf_epa_id: Receiving facility EPA ID must be three letters followed by nine digits', 400, [
      { field: 'tsdf_epa_id', message: 'Receiving facility EPA ID must be three letters followed by nine digits' },
    ]))
    await show(manifest())
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    await user.type(screen.getByLabelText('Receiving facility EPA ID'), 'bad')
    await user.click(screen.getByRole('button', { name: 'Save details' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('three letters followed by nine digits')
    expect(screen.getByLabelText('Receiving facility EPA ID')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Save details' })).toBeEnabled()
  })

  it('leaves the details alone on cancel', async () => {
    const user = userEvent.setup()
    await show(manifest())
    await user.click(screen.getByRole('button', { name: 'Edit details' }))
    await user.type(screen.getByLabelText('Transporter name'), ' and more')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(updateManifest).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Transporter name')).not.toBeInTheDocument()
  })
})
