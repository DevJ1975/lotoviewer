import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Outfall, Permit, SiteDetail } from '@/lib/environmental/client'

// The outfalls screen is driven the way an admin or a member would: read the table,
// start an inspection from a row, and (as an admin) add, edit and delete.

const listOutfalls = vi.fn()
const listPermits = vi.fn()
const createOutfall = vi.fn()
const updateOutfall = vi.fn()
const deleteOutfall = vi.fn()
vi.mock('@/lib/environmental/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/client')>('@/lib/environmental/client')
  return {
    ...actual,
    listOutfalls: (...a: unknown[]) => listOutfalls(...a),
    listPermits: (...a: unknown[]) => listPermits(...a),
    createOutfall: (...a: unknown[]) => createOutfall(...a),
    updateOutfall: (...a: unknown[]) => updateOutfall(...a),
    deleteOutfall: (...a: unknown[]) => deleteOutfall(...a),
  }
})
vi.mock('@/lib/environmental/evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/evidence')>('@/lib/environmental/evidence')
  return { ...actual, uploadEvidence: vi.fn(), evidenceUrl: vi.fn().mockResolvedValue('https://signed.example/photo.jpg') }
})

// Stable objects, as the real hooks return (the scope is memoized there): a new object
// on every render would re-run the page's load effect.
const AT_SITE = { tenantId: 'tenant-1', facilityId: 'site-1' }
const ROLL_UP = { tenantId: 'tenant-1', facilityId: null }
const SITE = {
  facility: { id: 'site-1', name: 'Plant 1', state: 'TX' },
  jurisdiction: { chain: ['federal', 'TX'], state: 'TX', status: 'supported' },
  notice: null,
  packs: [{ jurisdiction: 'federal', version: '1', status: 'draft', last_verified: null }],
} as unknown as SiteDetail

let env: { scope: typeof AT_SITE | typeof ROLL_UP; facilityId: string | null; facilityName: string | null; canAdmin: boolean; ready: boolean }
let site: SiteDetail | null
const adminAtSite = () => ({ scope: AT_SITE, facilityId: 'site-1', facilityName: 'Plant 1', canAdmin: true, ready: true })
const memberAtSite = () => ({ ...adminAtSite(), canAdmin: false })
const adminInRollUp = () => ({ scope: ROLL_UP, facilityId: null, facilityName: null, canAdmin: true, ready: true })

vi.mock('@/lib/environmental/useEnvironmental', () => ({
  useEnvironmentalScope: () => env,
  useEnvironmentalSite: () => ({ site, loading: false, error: null, reload: vi.fn(), setSite: vi.fn() }),
}))
const switchFacility = vi.fn()
const FACILITIES = { available: [{ id: 'site-1', name: 'Plant 1' }, { id: 'site-2', name: 'Plant 2' }], switchFacility }
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => FACILITIES }))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => <header><h1>{title}</h1><p>{description}</p></header>,
}))

import { ApiError } from '@/lib/environmental/client'
import EnvironmentalOutfalls from '@/app/environmental/compliance/outfalls/page'

const outfall = (over: Partial<Outfall> = {}): Outfall => ({
  id: 'o-1', facility_id: 'site-1', permit_id: null, code: 'OF-001', name: null, receiving_water: null, drainage_area: null,
  latitude: null, longitude: null, outfall_type: 'stormwater', substantially_identical_to: null, is_sampling_point: false,
  status: 'active', photo_path: null, notes: null, ...over,
})
const permit = (over: Partial<Permit> = {}): Permit => ({
  id: 'p-1', facility_id: 'site-1', program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000001',
  issuing_agency: null, jurisdiction: null, status: 'active', effective_date: null, expiration_date: null, renewal_lead_days: 180,
  identifiers: {}, conditions: [], document_path: null, notes: null, health: 'active', ...over,
})

const OF1 = outfall({
  id: 'o-1', code: 'OF-001', name: 'North apron', receiving_water: 'Walnut Creek', is_sampling_point: true, permit_id: 'p-1',
  latitude: 30.267153, longitude: -97.743057, photo_path: 'tenant-1/outfalls/of1.jpg', drainage_area: 'Loading dock roof', notes: 'Check after rain.',
})
const OF2 = outfall({ id: 'o-2', code: 'OF-002', name: 'South dock', outfall_type: 'combined', substantially_identical_to: 'o-1' })
const OF3_REMOVED = outfall({ id: 'o-3', code: 'OF-003', status: 'removed' })
const OF10 = outfall({ id: 'o-10', code: 'OF-10', status: 'inactive', outfall_type: 'authorized_nsw' })
const PERMIT_HERE = permit({ id: 'p-1' })
const PERMIT_ALSO_HERE = permit({ id: 'p-2', permit_type: 'Wastewater Discharge', permit_number: 'W-7' })
const PERMIT_ELSEWHERE = permit({ id: 'p-9', facility_id: 'site-2', permit_type: 'Other Plant Permit', permit_number: 'X-1' })

beforeEach(() => {
  for (const fn of [listOutfalls, listPermits, createOutfall, updateOutfall, deleteOutfall, switchFacility]) fn.mockReset()
  listOutfalls.mockResolvedValue({ outfalls: [OF10, OF2, OF3_REMOVED, OF1] })
  listPermits.mockResolvedValue({ permits: [PERMIT_HERE, PERMIT_ALSO_HERE, PERMIT_ELSEWHERE] })
  env = adminAtSite()
  site = SITE
})

async function tableLoaded() { await screen.findByRole('table') }
const rowOf = (code: string) => within(screen.getByRole('rowheader', { name: new RegExp(`^${code}\\b`) }).closest('tr')!)

describe('the table', () => {
  it('lists the outfalls at the site in code order, so OF-10 follows OF-003', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    expect(screen.getAllByRole('rowheader').map(h => h.textContent?.match(/^OF-\d+/)?.[0])).toEqual(['OF-001', 'OF-002', 'OF-003', 'OF-10'])
  })

  it('asks for the outfalls and the permits of the site, in step', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    expect(listOutfalls).toHaveBeenCalledWith(AT_SITE)
    expect(listPermits).toHaveBeenCalledWith(AT_SITE)
  })

  it('shows what each outfall is: name, water, type, sampling point, permit, status, location and photo', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    const row = rowOf('OF-001')

    expect(row.getByText('North apron')).toBeInTheDocument()
    expect(row.getByText('Walnut Creek')).toBeInTheDocument()
    expect(row.getByText('Stormwater')).toBeInTheDocument()
    expect(row.getByText('Sampling point')).toBeInTheDocument()
    expect(row.getByText('Industrial General Permit CAS000001')).toBeInTheDocument()
    expect(row.getByText('Active')).toBeInTheDocument()
    expect(row.getByText('30.267153, -97.743057')).toBeInTheDocument()
    const photo = await row.findByRole('link', { name: 'Photo of outfall OF-001' })
    expect(photo).toHaveAttribute('href', 'https://signed.example/photo.jpg')
  })

  it('resolves "Same as" to the code of the outfall it stands in for', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    const row = rowOf('OF-002')
    expect(row.getByText('Same as OF-001')).toBeInTheDocument()
    expect(row.getByText('Combined')).toBeInTheDocument()
    expect(rowOf('OF-10').getByText('Authorized non-stormwater')).toBeInTheDocument()
    expect(rowOf('OF-10').getByText('Inactive')).toBeInTheDocument()
    expect(rowOf('OF-003').getByText('Removed')).toBeInTheDocument()
  })

  it('shows a dash, not an invented value, for what an outfall does not have', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    expect(rowOf('OF-10').getAllByText('—').length).toBeGreaterThanOrEqual(5)
    expect(rowOf('OF-10').queryByText('Sampling point')).toBeNull()
  })

  it('says what is wrong when the outfalls cannot be loaded', async () => {
    listOutfalls.mockRejectedValue(new ApiError('Request failed (500)', 500, null, []))
    render(<EnvironmentalOutfalls />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)')
  })

  it('shows the how-to for outfalls and the jurisdiction in force', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    expect(screen.getByRole('button', { name: /how to use this page/i })).toBeInTheDocument()
    expect(screen.getByText('Federal + TX')).toBeInTheDocument()
  })
})

describe('the all-sites roll-up', () => {
  beforeEach(() => { env = adminInRollUp(); site = null })

  it('asks for one site, because outfalls belong to one, and loads nothing', async () => {
    render(<EnvironmentalOutfalls />)
    expect(await screen.findByText('Choose a site')).toBeInTheDocument()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull()
    expect(listOutfalls).not.toHaveBeenCalled()
    expect(listPermits).not.toHaveBeenCalled()
  })

  it('switches to the site that is picked', async () => {
    render(<EnvironmentalOutfalls />)
    await userEvent.click(await screen.findByRole('button', { name: 'Plant 2' }))
    expect(switchFacility).toHaveBeenCalledWith('site-2')
  })
})

describe('inspecting', () => {
  it('links every outfall that is still on the site to its checklists, for a member too', async () => {
    env = memberAtSite()
    render(<EnvironmentalOutfalls />)
    await tableLoaded()

    expect(screen.getByRole('link', { name: 'Inspect OF-001' })).toHaveAttribute('href', '/environmental/compliance/checklists?subject_type=outfall&subject=o-1')
    expect(screen.getByRole('link', { name: 'Inspect OF-002' })).toHaveAttribute('href', '/environmental/compliance/checklists?subject_type=outfall&subject=o-2')
    expect(screen.getByRole('link', { name: 'Inspect OF-10' })).toHaveAttribute('href', '/environmental/compliance/checklists?subject_type=outfall&subject=o-10')
  })

  it('does not offer to inspect an outfall that has been removed', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    expect(screen.queryByRole('link', { name: 'Inspect OF-003' })).toBeNull()
    expect(screen.getAllByRole('link', { name: /^Inspect / })).toHaveLength(3)
  })
})

describe('who can change what', () => {
  it('lets a member read the table and offers no way to change it', async () => {
    env = memberAtSite()
    render(<EnvironmentalOutfalls />)
    await tableLoaded()

    expect(screen.getByRole('rowheader', { name: /OF-001/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^edit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull()
  })

  it('lets an admin add, edit and delete', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    expect(screen.getByRole('button', { name: 'Add outfall' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^edit /i })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: /^delete /i })).toHaveLength(4)
  })
})

describe('with no outfalls', () => {
  beforeEach(() => { listOutfalls.mockResolvedValue({ outfalls: [] }) })

  it('explains what an outfall is and offers an admin the first one', async () => {
    render(<EnvironmentalOutfalls />)
    expect(await screen.findByText('No outfalls listed yet')).toBeInTheDocument()
    expect(screen.getByText(/a point where stormwater leaves the site/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add your first outfall' }))
    expect(await screen.findByRole('dialog', { name: 'Add an outfall' })).toBeInTheDocument()
  })

  it('tells a member who can add them instead of offering to', async () => {
    env = memberAtSite()
    render(<EnvironmentalOutfalls />)
    expect(await screen.findByText('No outfalls listed yet')).toBeInTheDocument()
    expect(screen.getByText(/a tenant admin can add them/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add your first outfall/i })).toBeNull()
  })
})

describe('adding an outfall', () => {
  async function openForm() {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add outfall' }))
    return within(await screen.findByRole('dialog', { name: 'Add an outfall' }))
  }

  it('sends what was entered as the API expects it, then closes and reloads the table', async () => {
    createOutfall.mockResolvedValue({ outfall: OF1 })
    const form = await openForm()

    await userEvent.type(form.getByLabelText(/^Code/), ' OF-004 ')
    await userEvent.type(form.getByLabelText(/^Name/), 'East culvert')
    await userEvent.type(form.getByLabelText(/^Receiving water/), 'Walnut Creek')
    await userEvent.type(form.getByLabelText(/^Latitude/), '30.5')
    await userEvent.type(form.getByLabelText(/^Longitude/), '-97.7')
    await userEvent.selectOptions(form.getByLabelText(/^Type/), 'combined')
    await userEvent.click(form.getByRole('checkbox', { name: 'This is a sampling point' }))
    await userEvent.selectOptions(form.getByLabelText(/^Substantially identical to/), 'o-1')
    await userEvent.selectOptions(form.getByLabelText(/^Permit/), 'p-2')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))

    await waitFor(() => expect(createOutfall).toHaveBeenCalledTimes(1))
    expect(createOutfall).toHaveBeenCalledWith(AT_SITE, {
      code: 'OF-004', name: 'East culvert', receiving_water: 'Walnut Creek', drainage_area: null, latitude: 30.5, longitude: -97.7,
      outfall_type: 'combined', status: 'active', is_sampling_point: true, substantially_identical_to: 'o-1', permit_id: 'p-2',
      photo_path: null, notes: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listOutfalls).toHaveBeenCalledTimes(2))
  })

  it('sends no location when none is given', async () => {
    createOutfall.mockResolvedValue({ outfall: OF1 })
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Code/), 'OF-004')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))

    await waitFor(() => expect(createOutfall).toHaveBeenCalledTimes(1))
    expect(createOutfall.mock.calls[0]![1]).toMatchObject({ latitude: null, longitude: null, substantially_identical_to: null, permit_id: null })
  })

  it('refuses a latitude without a longitude, and a longitude without a latitude, before sending anything', async () => {
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Code/), 'OF-004')

    await userEvent.type(form.getByLabelText(/^Latitude/), '30.5')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))
    expect(await form.findByRole('alert')).toHaveTextContent('Latitude and longitude go together: give both or neither.')

    await userEvent.clear(form.getByLabelText(/^Latitude/))
    await userEvent.type(form.getByLabelText(/^Longitude/), '-97.7')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))
    expect(await form.findByRole('alert')).toHaveTextContent('Latitude and longitude go together: give both or neither.')

    expect(createOutfall).not.toHaveBeenCalled()
  })

  it('accepts the pair once both are given', async () => {
    createOutfall.mockResolvedValue({ outfall: OF1 })
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Code/), 'OF-004')
    await userEvent.type(form.getByLabelText(/^Latitude/), '30.5')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))
    await form.findByRole('alert')

    await userEvent.type(form.getByLabelText(/^Longitude/), '-97.7')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))

    await waitFor(() => expect(createOutfall).toHaveBeenCalledTimes(1))
    expect(createOutfall.mock.calls[0]![1]).toMatchObject({ latitude: 30.5, longitude: -97.7 })
  })

  it('offers this site\'s permits and outfalls to point at, and no one else\'s', async () => {
    const form = await openForm()
    const permits = within(form.getByLabelText(/^Permit/)).getAllByRole('option').map(o => o.textContent)
    expect(permits).toEqual(['No permit selected', 'Industrial General Permit CAS000001', 'Wastewater Discharge W-7'])
    const partners = within(form.getByLabelText(/^Substantially identical to/)).getAllByRole('option').map(o => o.textContent)
    expect(partners).toEqual(['Not identical to another outfall', 'OF-001: North apron', 'OF-002: South dock', 'OF-003', 'OF-10'])
  })

  it('takes a photo from the camera or a file, as an image', async () => {
    const form = await openForm()
    const input = form.getByLabelText('Take or attach a photo')
    expect(input).toHaveAttribute('accept', 'image/*')
    expect(input).toHaveAttribute('capture', 'environment')
  })

  it('shows the API\'s own words when the code is already used, and keeps the form open', async () => {
    createOutfall.mockRejectedValue(new ApiError('dup', 409, 'duplicate_outfall_code', ['This site already has an outfall with that code.']))
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Code/), 'OF-001')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))

    expect(await form.findByRole('alert')).toHaveTextContent('This site already has an outfall with that code.')
    expect(screen.getByRole('dialog', { name: 'Add an outfall' })).toBeInTheDocument()
    expect(listOutfalls).toHaveBeenCalledTimes(1)
  })

  it('shows the API\'s words when it refuses a permit from another site', async () => {
    createOutfall.mockRejectedValue(new ApiError('bad', 400, 'invalid_body', ['permit_id must be a permit at this site.']))
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Code/), 'OF-004')
    await userEvent.click(form.getByRole('button', { name: 'Add outfall' }))
    expect(await form.findByRole('alert')).toHaveTextContent('permit_id must be a permit at this site.')
  })

  it('closes on Escape without saving, and hands focus back to where it came from', async () => {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    const trigger = screen.getByRole('button', { name: 'Add outfall' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Add an outfall' })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(createOutfall).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('editing an outfall', () => {
  async function openEdit() {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Edit OF-001' }))
    return within(await screen.findByRole('dialog', { name: 'Edit outfall OF-001' }))
  }

  it('starts from what is stored', async () => {
    const form = await openEdit()
    expect(form.getByLabelText(/^Code/)).toHaveValue('OF-001')
    expect(form.getByLabelText(/^Receiving water/)).toHaveValue('Walnut Creek')
    expect(form.getByLabelText(/^Latitude/)).toHaveValue(30.267153)
    expect(form.getByLabelText(/^Longitude/)).toHaveValue(-97.743057)
    expect(form.getByRole('checkbox', { name: 'This is a sampling point' })).toBeChecked()
    expect(form.getByLabelText(/^Permit/)).toHaveValue('p-1')
  })

  it('does not offer the outfall itself as the one it is substantially identical to', async () => {
    const form = await openEdit()
    const partners = within(form.getByLabelText(/^Substantially identical to/)).getAllByRole('option').map(o => o.textContent)
    expect(partners).toEqual(['Not identical to another outfall', 'OF-002: South dock', 'OF-003', 'OF-10'])
  })

  it('sends the whole outfall back with the change', async () => {
    updateOutfall.mockResolvedValue({ outfall: OF1 })
    const form = await openEdit()
    await userEvent.clear(form.getByLabelText(/^Name/))
    await userEvent.type(form.getByLabelText(/^Name/), 'North loading apron')
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateOutfall).toHaveBeenCalledTimes(1))
    expect(updateOutfall).toHaveBeenCalledWith(AT_SITE, 'o-1', {
      code: 'OF-001', name: 'North loading apron', receiving_water: 'Walnut Creek', drainage_area: 'Loading dock roof', latitude: 30.267153,
      longitude: -97.743057, outfall_type: 'stormwater', status: 'active', is_sampling_point: true, substantially_identical_to: null,
      permit_id: 'p-1', photo_path: 'tenant-1/outfalls/of1.jpg', notes: 'Check after rain.',
    })
    expect(createOutfall).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('clears the location when both numbers are emptied', async () => {
    updateOutfall.mockResolvedValue({ outfall: OF1 })
    const form = await openEdit()
    await userEvent.clear(form.getByLabelText(/^Latitude/))
    await userEvent.clear(form.getByLabelText(/^Longitude/))
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateOutfall).toHaveBeenCalledTimes(1))
    expect(updateOutfall.mock.calls[0]![2]).toMatchObject({ latitude: null, longitude: null })
  })

  it('refuses to leave one coordinate behind', async () => {
    const form = await openEdit()
    await userEvent.clear(form.getByLabelText(/^Latitude/))
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))

    expect(await form.findByRole('alert')).toHaveTextContent('Latitude and longitude go together: give both or neither.')
    expect(updateOutfall).not.toHaveBeenCalled()
  })

  it('shows the API\'s words when the edit is refused', async () => {
    updateOutfall.mockRejectedValue(new ApiError('bad', 400, 'invalid_body', ['substantially_identical_to must be another outfall at this site.']))
    const form = await openEdit()
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))
    expect(await form.findByRole('alert')).toHaveTextContent('substantially_identical_to must be another outfall at this site.')
  })
})

describe('deleting an outfall', () => {
  async function askToDelete() {
    render(<EnvironmentalOutfalls />)
    await tableLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Delete OF-002' }))
    return within(await screen.findByRole('dialog', { name: 'Delete outfall OF-002?' }))
  }

  it('asks first, and says what happens to outfalls that point at it', async () => {
    const dialog = await askToDelete()
    expect(dialog.getByText(/loses that link/i)).toBeInTheDocument()
    expect(deleteOutfall).not.toHaveBeenCalled()
  })

  it('deletes nothing when the question is answered with Cancel', async () => {
    const dialog = await askToDelete()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteOutfall).not.toHaveBeenCalled()
  })

  it('deletes that one outfall when confirmed, then reloads the table', async () => {
    deleteOutfall.mockResolvedValue({ ok: true })
    const dialog = await askToDelete()
    await userEvent.click(dialog.getByRole('button', { name: 'Delete outfall' }))

    await waitFor(() => expect(deleteOutfall).toHaveBeenCalledWith(AT_SITE, 'o-2'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listOutfalls).toHaveBeenCalledTimes(2))
  })

  it('keeps the question open and says why when the delete fails', async () => {
    deleteOutfall.mockRejectedValue(new ApiError('That record no longer exists.', 404, 'not_found', []))
    const dialog = await askToDelete()
    await userEvent.click(dialog.getByRole('button', { name: 'Delete outfall' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('That record no longer exists.')
    expect(listOutfalls).toHaveBeenCalledTimes(1)
  })
})
