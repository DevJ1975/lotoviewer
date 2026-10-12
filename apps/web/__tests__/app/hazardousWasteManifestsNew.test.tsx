import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ManifestDetail, ShippableContainer } from '@/lib/hazardousWasteManifestView'

// "New manifest": choosing closed containers, filling the details, and what the screen says about what
// drafting will do to the containers.

const listShippableContainers = vi.fn()
const createManifest = vi.fn()
vi.mock('@/app/hazardous-waste/manifests/_lib/manifestClient', async () => {
  const actual = await vi.importActual<typeof import('@/app/hazardous-waste/manifests/_lib/manifestClient')>('@/app/hazardous-waste/manifests/_lib/manifestClient')
  return {
    ...actual,
    listShippableContainers: (...a: unknown[]) => listShippableContainers(...a),
    createManifest: (...a: unknown[]) => createManifest(...a),
  }
})
const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
const TENANT = { tenant: { id: 'tenant-1' }, tenantId: 'tenant-1' }
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => TENANT }))

let facilityState: { facility: { id: string; name: string; settings: Record<string, unknown> } | null }
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => facilityState }))

import NewHazardousWasteManifestPage from '@/app/hazardous-waste/manifests/new/page'
import { ManifestApiError } from '@/app/hazardous-waste/manifests/_lib/manifestClient'

const container = (id: string, label: string, over: Partial<ShippableContainer> = {}): ShippableContainer => ({
  id, label, area_location: 'Dock 2', volume_quantity: 55, volume_unit: 'gallons', accumulation_started_at: null,
  stream: { id: 's1', name: 'Spent solvent', waste_codes: ['D001', 'F003'] }, ...over,
})
const DRUM_1 = container('c1', 'Drum 1')
const DRUM_2 = container('c2', 'Drum 2', { stream: { id: 's2', name: 'Paint waste', waste_codes: ['F003', '134'] } })

const SITE_WITH_PROFILE = {
  id: 'site-1', name: 'Plant 1',
  settings: { hazardous_waste: { generator_category: 'lqg', jurisdiction: 'california', epa_id_number: 'CAL000123456' } },
}

beforeEach(() => {
  for (const fn of [listShippableContainers, createManifest, push]) fn.mockReset()
  listShippableContainers.mockResolvedValue({ containers: [DRUM_1, DRUM_2], total: 2 })
  facilityState = { facility: SITE_WITH_PROFILE }
})

async function formLoaded() { await screen.findByRole('group', { name: 'Containers on this shipment' }) }

describe('choosing containers', () => {
  it('lists the closed containers at the site as labelled checkboxes with what is in them', async () => {
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    const drum1 = screen.getByRole('checkbox', { name: /Drum 1/ })
    expect(drum1).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Drum 1.*Spent solvent · Dock 2 · 55 gallons/ })).toBe(drum1)
    expect(screen.getByRole('checkbox', { name: /Drum 2.*Paint waste/ })).toBeInTheDocument()
    expect(screen.getByText(/Closed containers at/)).toHaveTextContent('Plant 1')
    expect(listShippableContainers).toHaveBeenCalledWith('tenant-1')
  })

  it('says at every moment what drafting will do to the containers chosen', async () => {
    const user = userEvent.setup()
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    expect(screen.getByText('Choose at least one container.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create draft manifest' })).toBeDisabled()

    await user.click(screen.getByRole('checkbox', { name: /Drum 1/ }))
    expect(screen.getByText('The 1 selected container will move to In shipment.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create draft manifest' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: /Drum 2/ }))
    expect(screen.getByText('The 2 selected containers will move to In shipment.')).toBeInTheDocument()
  })

  it('selects all and clears', async () => {
    const user = userEvent.setup()
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    await user.click(screen.getByRole('button', { name: 'Select all' }))
    expect(screen.getAllByRole('checkbox', { name: /Drum/ }).every(box => (box as HTMLInputElement).checked)).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getAllByRole('checkbox', { name: /Drum/ }).some(box => (box as HTMLInputElement).checked)).toBe(false)
  })

  it('can be operated from the keyboard: space ticks a container, enter submits the form', async () => {
    const user = userEvent.setup()
    createManifest.mockResolvedValue({ manifest: { id: 'new-1' } as ManifestDetail })
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    screen.getByRole('checkbox', { name: /Drum 1/ }).focus()
    await user.keyboard(' ')
    expect(screen.getByRole('checkbox', { name: /Drum 1/ })).toBeChecked()
    await user.type(screen.getByLabelText('Manifest tracking number'), '123456789ELC{Enter}')
    expect(createManifest).toHaveBeenCalledTimes(1)
  })

  it('invites closing a container first when none is ready, with a link to the containers', async () => {
    listShippableContainers.mockResolvedValue({ containers: [], total: 0 })
    render(<NewHazardousWasteManifestPage />)
    expect(await screen.findByText(/No closed containers at this site to ship/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /close one on the Containers page/ })).toHaveAttribute('href', '/hazardous-waste/containers')
    expect(screen.queryByRole('button', { name: 'Create draft manifest' })).not.toBeInTheDocument()
  })

  it('shows a load error in an alert, and no form', async () => {
    listShippableContainers.mockRejectedValue(new Error('Not a member of this tenant'))
    render(<NewHazardousWasteManifestPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not a member of this tenant')
    expect(screen.queryByRole('button', { name: 'Create draft manifest' })).not.toBeInTheDocument()
  })

  it('says when only part of a long list is shown', async () => {
    listShippableContainers.mockResolvedValue({ containers: [DRUM_1, DRUM_2], total: 250 })
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    expect(screen.getByText(/showing the first 2 of 250/)).toBeInTheDocument()
  })
})

describe('the details', () => {
  it('starts from the site\'s generator profile: category, California rules and its EPA ID', async () => {
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    expect(screen.getByLabelText(/Generator category/)).toHaveValue('lqg')
    expect(screen.getByLabelText('Rules that apply')).toHaveValue('state')
    expect(screen.getByLabelText('State (two letters)')).toHaveValue('CA')
    expect(screen.getByLabelText('Generator EPA ID')).toHaveValue('CAL000123456')
  })

  it('leaves the category to be chosen when the site has no profile, rather than guessing', async () => {
    facilityState = { facility: null }
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    expect(screen.getByLabelText(/Generator category/)).toHaveValue('')
    expect(screen.getByLabelText('Rules that apply')).toHaveValue('federal')
    expect(screen.queryByLabelText('State (two letters)')).not.toBeInTheDocument()
    expect(screen.getByText(/Closed containers at every site/)).toBeInTheDocument()
  })

  it('gives every control a label that is its name, with its hint described by it', async () => {
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    for (const label of [/Generator category/, 'Rules that apply', 'Manifest tracking number', 'Generator EPA ID', 'Transporter name', 'Transporter EPA ID',
      'Receiving facility name', 'Receiving facility EPA ID', 'Waste codes', 'Shipping description', 'Submitted through EPA e-Manifest', 'Notes']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByLabelText('Manifest tracking number')).toHaveAccessibleDescription(/Nine digits and three letters/)
  })

  it('offers the waste codes of the chosen containers\' streams, and fills them in only when asked', async () => {
    const user = userEvent.setup()
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    expect(screen.queryByRole('button', { name: 'Use these waste codes' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Drum 1/ }))
    await user.click(screen.getByRole('checkbox', { name: /Drum 2/ }))
    expect(screen.getByLabelText('Waste codes')).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'Use these waste codes' }))

    expect(screen.getByLabelText('Waste codes')).toHaveValue('D001, F003, 134')
    expect(screen.queryByRole('button', { name: 'Use these waste codes' })).not.toBeInTheDocument()
  })
})

describe('creating the draft', () => {
  it('sends the containers and the details, then opens the new manifest', async () => {
    const user = userEvent.setup()
    createManifest.mockResolvedValue({ manifest: { id: 'new-1' } as ManifestDetail })
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()

    await user.click(screen.getByRole('checkbox', { name: /Drum 1/ }))
    await user.click(screen.getByRole('checkbox', { name: /Drum 2/ }))
    await user.type(screen.getByLabelText('Manifest tracking number'), '123456789ELC')
    await user.type(screen.getByLabelText('Transporter name'), 'Haul Co')
    await user.type(screen.getByLabelText('Waste codes'), 'D001, 134')
    await user.click(screen.getByLabelText('Submitted through EPA e-Manifest'))
    await user.click(screen.getByRole('button', { name: 'Create draft manifest' }))

    expect(createManifest).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      container_ids: ['c1', 'c2'], generator_category: 'lqg', jurisdiction: 'state:CA', manifest_tracking_number: '123456789ELC',
      transporter_name: 'Haul Co', waste_codes: ['D001', '134'], electronic: true, generator_epa_id: 'CAL000123456',
    }))
    expect(push).toHaveBeenCalledWith('/hazardous-waste/manifests/new-1')
  })

  it('shows the refusal in an alert, marks the field it is about, and keeps what was typed', async () => {
    const user = userEvent.setup()
    createManifest.mockRejectedValue(new ManifestApiError('manifest_tracking_number: Tracking number must be nine digits followed by three letters', 400, [
      { field: 'manifest_tracking_number', message: 'Tracking number must be nine digits followed by three letters' },
    ]))
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    await user.click(screen.getByRole('checkbox', { name: /Drum 1/ }))
    await user.type(screen.getByLabelText('Manifest tracking number'), '12345')
    await user.click(screen.getByRole('button', { name: 'Create draft manifest' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Tracking number must be nine digits')
    const field = screen.getByLabelText('Manifest tracking number')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(/Tracking number must be nine digits followed by three letters/)
    expect(field).toHaveValue('12345')
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Create draft manifest' })).toBeEnabled()
  })

  it('puts a refused state code under the state field, once', async () => {
    const user = userEvent.setup()
    createManifest.mockRejectedValue(new ManifestApiError('jurisdiction: Jurisdiction must be federal or a state such as state:CA', 400, [
      { field: 'jurisdiction', message: 'Jurisdiction must be federal or a state such as state:CA' },
    ]))
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    await user.clear(screen.getByLabelText('State (two letters)'))
    await user.click(screen.getByRole('checkbox', { name: /Drum 1/ }))
    await user.click(screen.getByRole('button', { name: 'Create draft manifest' }))

    await screen.findByRole('alert')
    expect(screen.getByLabelText('State (two letters)')).toHaveAccessibleDescription(/Jurisdiction must be federal or a state/)
    expect(screen.getByLabelText('Rules that apply')).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getAllByText(/Jurisdiction must be federal or a state such as state:CA/)).toHaveLength(2)   // the alert and the field
  })

  it('shows what the database said when a container turned out not to be ready', async () => {
    const user = userEvent.setup()
    createManifest.mockRejectedValue(new ManifestApiError('Only closed containers can go on a manifest. Not ready: Drum 1 (in shipment).', 409))
    render(<NewHazardousWasteManifestPage />)
    await formLoaded()
    await user.click(screen.getByRole('checkbox', { name: /Drum 1/ }))
    await user.click(screen.getByRole('button', { name: 'Create draft manifest' }))
    expect(within(await screen.findByRole('alert')).getByText(/Not ready: Drum 1 \(in shipment\)/)).toBeInTheDocument()
  })
})
