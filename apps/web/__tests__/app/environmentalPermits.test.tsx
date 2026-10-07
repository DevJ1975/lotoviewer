import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Permit, SiteDetail } from '@/lib/environmental/client'

// The permits screen is driven the way an admin or a member would: read the list,
// open the form, see what the API says back, and be asked before anything is deleted.

const listPermits = vi.fn()
const createPermit = vi.fn()
const updatePermit = vi.fn()
const deletePermit = vi.fn()
vi.mock('@/lib/environmental/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/client')>('@/lib/environmental/client')
  return {
    ...actual,
    listPermits: (...a: unknown[]) => listPermits(...a),
    createPermit: (...a: unknown[]) => createPermit(...a),
    updatePermit: (...a: unknown[]) => updatePermit(...a),
    deletePermit: (...a: unknown[]) => deletePermit(...a),
  }
})
vi.mock('@/lib/environmental/evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/evidence')>('@/lib/environmental/evidence')
  return { ...actual, uploadEvidence: vi.fn(), evidenceUrl: vi.fn().mockResolvedValue('https://signed.example/permit.pdf') }
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
import EnvironmentalPermits from '@/app/environmental/compliance/permits/page'

const permit = (over: Partial<Permit> = {}): Permit => ({
  id: 'p-1', facility_id: 'site-1', program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000001',
  issuing_agency: null, jurisdiction: null, status: 'active', effective_date: null, expiration_date: null, renewal_lead_days: 180,
  identifiers: {}, conditions: [], document_path: null, notes: null, health: 'active', ...over,
})

const EXPIRED = permit({ id: 'p-expired', permit_type: 'Air Permit', permit_number: 'A-1', program: 'air', health: 'expired', expiration_date: '2026-09-25' })
const EXPIRING = permit({
  id: 'p-expiring', permit_type: 'Industrial General Permit', permit_number: 'CAS000001', health: 'expiring', expiration_date: '2027-01-09',
  effective_date: '2022-01-10', issuing_agency: 'State Water Board', jurisdiction: 'TX', renewal_lead_days: 180,
  identifiers: { WDID: '2 15I012345' }, document_path: 'tenant-1/permits/a.pdf', notes: 'Binder is in the EHS office.',
  conditions: [{ id: 'c-1', text: 'Sample each outfall quarterly', frequency: 'Quarterly', ref: 'Part III.A' }, { id: 'c-2', text: 'Keep the SWPPP current' }],
})
const ACTIVE = permit({ id: 'p-active', permit_type: 'Wastewater Discharge', permit_number: 'W-7', program: 'wastewater', health: 'active', expiration_date: '2027-10-07' })
const DRAFT = permit({ id: 'p-draft', permit_type: 'SPCC Plan', permit_number: null, program: 'spcc', status: 'draft', health: 'not_tracked' })

// "Now" is the 7th of October 2026, so 2027-01-09 is 94 days off and 2026-09-25 was 12 days ago.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-07T12:00:00Z'))
  for (const fn of [listPermits, createPermit, updatePermit, deletePermit, switchFacility]) fn.mockReset()
  listPermits.mockResolvedValue({ permits: [DRAFT, ACTIVE, EXPIRING, EXPIRED] })
  env = adminAtSite()
  site = SITE
})
afterEach(() => { vi.useRealTimers() })

const article = (name: string) => screen.getByRole('article', { name })
async function listLoaded() { await screen.findAllByRole('article') }

describe('the list', () => {
  it('shows the most urgent permit first, each with its health in words', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()

    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual([
      'Air Permit', 'Industrial General Permit', 'Wastewater Discharge', 'SPCC Plan',
    ])
    expect(within(article('Air Permit')).getByText('Expired 12 days ago')).toBeInTheDocument()
    expect(within(article('Industrial General Permit')).getByText('Expires in 94 days; renewal window open')).toBeInTheDocument()
    expect(within(article('Wastewater Discharge')).getByText('Expires in 365 days; renewal window opens in 185 days')).toBeInTheDocument()
    expect(within(article('SPCC Plan')).getByText('Not tracked: status is draft')).toBeInTheDocument()
  })

  it('names the health as a word as well as a color', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()
    expect(within(article('Air Permit')).getByText('Expired')).toBeInTheDocument()
    expect(within(article('Industrial General Permit')).getByText('Expiring')).toBeInTheDocument()
    expect(within(article('Wastewater Discharge')).getByText('Active')).toBeInTheDocument()
    expect(within(article('SPCC Plan')).getByText('Not tracked')).toBeInTheDocument()
  })

  it('shows a permit\'s agency, dates, renewal deadline, identifiers, conditions and a signed link to its document', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()
    const card = within(article('Industrial General Permit'))

    expect(card.getByText('State Water Board')).toBeInTheDocument()
    expect(card.getByText('State (TX)')).toBeInTheDocument()
    expect(card.getByText('2022-01-10')).toBeInTheDocument()
    expect(card.getByText('2027-01-09')).toBeInTheDocument()
    // 180 days before 2027-01-09
    expect(card.getByText('2026-07-13')).toBeInTheDocument()
    expect(card.getByText('WDID:')).toBeInTheDocument()
    expect(card.getByText('2 15I012345')).toBeInTheDocument()
    expect(card.getByText('Conditions (2)')).toBeInTheDocument()
    expect(card.getByText('Sample each outfall quarterly')).toBeInTheDocument()
    expect(card.getByText('Frequency: Quarterly')).toBeInTheDocument()
    expect(card.getByText('Reference: Part III.A')).toBeInTheDocument()
    expect(card.getByText('Binder is in the EHS office.')).toBeInTheDocument()
    expect(await card.findByRole('link', { name: /view permit document/i })).toHaveAttribute('href', 'https://signed.example/permit.pdf')
  })

  it('shows a dash, not a made-up value, for what a permit does not have', async () => {
    listPermits.mockResolvedValue({ permits: [DRAFT] })
    render(<EnvironmentalPermits />)
    await listLoaded()
    const card = within(article('SPCC Plan'))
    expect(card.getAllByText('—').length).toBeGreaterThanOrEqual(4)
    expect(card.queryByText('Conditions', { exact: false })).toBeNull()
  })

  it('says what is wrong when the list cannot be loaded', async () => {
    listPermits.mockRejectedValue(new ApiError('Request failed (500)', 500, null, []))
    render(<EnvironmentalPermits />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)')
  })

  it('shows the how-to for permits, and the jurisdiction in force', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()
    expect(screen.getByRole('button', { name: /how to use this page/i })).toBeInTheDocument()
    expect(screen.getByText('Federal + TX')).toBeInTheDocument()
    expect(screen.getByText(/Draft: pending expert review/)).toBeInTheDocument()
  })
})

describe('who can change what', () => {
  it('lets a member read every permit and offers no way to change one', async () => {
    env = memberAtSite()
    render(<EnvironmentalPermits />)
    await listLoaded()

    expect(screen.getAllByRole('article')).toHaveLength(4)
    expect(screen.queryByRole('button', { name: /add permit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^edit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull()
  })

  it('lets an admin add, edit and delete at a site', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()

    expect(screen.getByRole('button', { name: 'Add permit' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^edit /i })).toHaveLength(4)
    expect(screen.getAllByRole('button', { name: /^delete /i })).toHaveLength(4)
  })

  it('asks an admin looking at all sites to choose one, shows each permit\'s site, and offers no change', async () => {
    env = adminInRollUp()
    site = null
    render(<EnvironmentalPermits />)
    await listLoaded()

    expect(screen.getByText('Choose a site')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add permit/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^edit /i })).toBeNull()
    expect(within(article('Air Permit')).getByText('Plant 1')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Plant 2' }))
    expect(switchFacility).toHaveBeenCalledWith('site-2')
  })

  it('does not show a site on each permit when one site is selected', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()
    expect(within(article('Air Permit')).queryByText('Site')).toBeNull()
  })
})

describe('with no permits', () => {
  beforeEach(() => { listPermits.mockResolvedValue({ permits: [] }) })

  it('explains why permits matter, mentions the document reader, and offers an admin the first one', async () => {
    render(<EnvironmentalPermits />)
    expect(await screen.findByText('No permits recorded yet')).toBeInTheDocument()
    expect(screen.getByText(/the calendar warns you before it lapses/i)).toBeInTheDocument()
    expect(screen.getByText(/separate document reader/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add your first permit' })).toBeInTheDocument()
  })

  it('tells a member who can add them instead of offering to', async () => {
    env = memberAtSite()
    render(<EnvironmentalPermits />)
    expect(await screen.findByText('No permits recorded yet')).toBeInTheDocument()
    expect(screen.getByText(/a tenant admin can add them/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add your first permit/i })).toBeNull()
  })

  it('opens the same form from the first-permit action', async () => {
    render(<EnvironmentalPermits />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add your first permit' }))
    expect(await screen.findByRole('dialog', { name: 'Add a permit' })).toBeInTheDocument()
  })
})

describe('adding a permit', () => {
  async function openForm() {
    render(<EnvironmentalPermits />)
    await listLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add permit' }))
    return within(await screen.findByRole('dialog', { name: 'Add a permit' }))
  }

  it('sends what was entered as the API expects it, then closes and reloads the list', async () => {
    createPermit.mockResolvedValue({ permit: EXPIRING })
    const form = await openForm()

    await userEvent.selectOptions(form.getByLabelText(/^Program/), 'stormwater')
    await userEvent.type(form.getByLabelText(/^Permit type/), '  Industrial General Permit ')
    await userEvent.type(form.getByLabelText(/^Permit number/), 'CAS000002')
    await userEvent.type(form.getByLabelText(/^Issuing agency/), 'State Water Board')
    await userEvent.selectOptions(form.getByLabelText(/^Jurisdiction/), 'TX')
    fireEvent.change(form.getByLabelText(/^Effective date/), { target: { value: '2024-01-10' } })
    fireEvent.change(form.getByLabelText(/^Expiration date/), { target: { value: '2029-01-09' } })
    await userEvent.type(form.getByLabelText(/^Notes/), 'New permit')

    await userEvent.click(form.getByRole('button', { name: 'Add identifier' }))
    await userEvent.type(form.getByLabelText('Identifier 1 name'), 'WDID')
    await userEvent.type(form.getByLabelText('Identifier 1 value'), '2 15I099999')
    await userEvent.click(form.getByRole('button', { name: 'Add condition' }))
    await userEvent.type(form.getByLabelText('Condition 1 text'), 'Sample quarterly')
    await userEvent.type(form.getByLabelText('Condition 1 frequency'), 'Quarterly')
    await userEvent.type(form.getByLabelText('Condition 1 reference'), 'Part III.A')
    // A second row left empty is dropped, not sent.
    await userEvent.click(form.getByRole('button', { name: 'Add condition' }))

    await userEvent.click(form.getByRole('button', { name: 'Add permit' }))

    await waitFor(() => expect(createPermit).toHaveBeenCalledTimes(1))
    expect(createPermit).toHaveBeenCalledWith(AT_SITE, {
      program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000002', issuing_agency: 'State Water Board',
      jurisdiction: 'TX', status: 'active', effective_date: '2024-01-10', expiration_date: '2029-01-09', renewal_lead_days: 180,
      identifiers: { WDID: '2 15I099999' },
      conditions: [{ id: expect.any(String), text: 'Sample quarterly', frequency: 'Quarterly', ref: 'Part III.A' }],
      document_path: null, notes: 'New permit',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listPermits).toHaveBeenCalledTimes(2))
  })

  it('starts with the 180-day lead time and the hint that it is a safety margin', async () => {
    const form = await openForm()
    expect(form.getByLabelText(/^Renewal lead time/)).toHaveValue(180)
    expect(form.getByText('The permit itself says what your agency requires; this is your safety margin')).toBeInTheDocument()
  })

  it('offers federal and the site\'s state as the jurisdiction', async () => {
    const form = await openForm()
    const options = within(form.getByLabelText(/^Jurisdiction/)).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Not specified', 'Federal', 'State (TX)'])
  })

  it('attaches the document from the permits folder, as a PDF or an image', async () => {
    const form = await openForm()
    const file = form.getByLabelText('Attach the permit document')
    expect(file).toHaveAttribute('accept', 'application/pdf,image/*')
  })

  it('shows the API\'s own words when the number is already used, and keeps the form open', async () => {
    createPermit.mockRejectedValue(new ApiError('dup', 409, 'duplicate_permit_number', ['This site already has a permit with that number for this program.']))
    const form = await openForm()
    await userEvent.selectOptions(form.getByLabelText(/^Program/), 'air')
    await userEvent.type(form.getByLabelText(/^Permit type/), 'Air Permit')
    await userEvent.click(form.getByRole('button', { name: 'Add permit' }))

    expect(await form.findByRole('alert')).toHaveTextContent('This site already has a permit with that number for this program.')
    expect(screen.getByRole('dialog', { name: 'Add a permit' })).toBeInTheDocument()
    expect(listPermits).toHaveBeenCalledTimes(1)
  })

  it('shows every validation message the API gives', async () => {
    createPermit.mockRejectedValue(new ApiError('bad', 400, 'invalid_body', ['expiration_date cannot be before effective_date.', 'permit_type is required.']))
    const form = await openForm()
    await userEvent.selectOptions(form.getByLabelText(/^Program/), 'air')
    await userEvent.type(form.getByLabelText(/^Permit type/), 'Air Permit')
    await userEvent.click(form.getByRole('button', { name: 'Add permit' }))

    const alert = await form.findByRole('alert')
    expect(alert).toHaveTextContent('expiration_date cannot be before effective_date.')
    expect(alert).toHaveTextContent('permit_type is required.')
  })

  it('points at a condition with no text without sending anything', async () => {
    const form = await openForm()
    await userEvent.selectOptions(form.getByLabelText(/^Program/), 'air')
    await userEvent.type(form.getByLabelText(/^Permit type/), 'Air Permit')
    await userEvent.click(form.getByRole('button', { name: 'Add condition' }))
    await userEvent.type(form.getByLabelText('Condition 1 frequency'), 'Monthly')
    await userEvent.click(form.getByRole('button', { name: 'Add permit' }))

    expect(await form.findByRole('alert')).toHaveTextContent('Condition 1 needs text.')
    expect(createPermit).not.toHaveBeenCalled()
  })

  it('closes on Escape without saving, and hands focus back to where it came from', async () => {
    render(<EnvironmentalPermits />)
    await listLoaded()
    const trigger = screen.getByRole('button', { name: 'Add permit' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Add a permit' })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(createPermit).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('editing a permit', () => {
  async function openEdit() {
    render(<EnvironmentalPermits />)
    await listLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Edit Industrial General Permit CAS000001' }))
    return within(await screen.findByRole('dialog', { name: 'Edit Industrial General Permit CAS000001' }))
  }

  it('starts from what is stored', async () => {
    const form = await openEdit()
    expect(form.getByLabelText(/^Program/)).toHaveValue('stormwater')
    expect(form.getByLabelText(/^Permit number/)).toHaveValue('CAS000001')
    expect(form.getByLabelText(/^Jurisdiction/)).toHaveValue('TX')
    expect(form.getByLabelText(/^Expiration date/)).toHaveValue('2027-01-09')
    expect(form.getByLabelText('Identifier 1 name')).toHaveValue('WDID')
    expect(form.getByLabelText('Condition 1 text')).toHaveValue('Sample each outfall quarterly')
    expect(form.getByLabelText('Condition 2 frequency')).toHaveValue('')
  })

  it('sends the whole permit back with the change, keeping each condition\'s id', async () => {
    updatePermit.mockResolvedValue({ permit: EXPIRING })
    const form = await openEdit()

    fireEvent.change(form.getByLabelText(/^Expiration date/), { target: { value: '2027-06-30' } })
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updatePermit).toHaveBeenCalledTimes(1))
    expect(updatePermit).toHaveBeenCalledWith(AT_SITE, 'p-expiring', {
      program: 'stormwater', permit_type: 'Industrial General Permit', permit_number: 'CAS000001', issuing_agency: 'State Water Board',
      jurisdiction: 'TX', status: 'active', effective_date: '2022-01-10', expiration_date: '2027-06-30', renewal_lead_days: 180,
      identifiers: { WDID: '2 15I012345' },
      conditions: [{ id: 'c-1', text: 'Sample each outfall quarterly', frequency: 'Quarterly', ref: 'Part III.A' }, { id: 'c-2', text: 'Keep the SWPPP current' }],
      document_path: 'tenant-1/permits/a.pdf', notes: 'Binder is in the EHS office.',
    })
    expect(createPermit).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listPermits).toHaveBeenCalledTimes(2))
  })

  it('removes a condition that was taken out and a field that was emptied', async () => {
    updatePermit.mockResolvedValue({ permit: EXPIRING })
    const form = await openEdit()

    await userEvent.click(form.getByRole('button', { name: 'Remove condition 2' }))
    await userEvent.clear(form.getByLabelText(/^Issuing agency/))
    await userEvent.click(form.getByRole('button', { name: 'Remove identifier 1' }))
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updatePermit).toHaveBeenCalledTimes(1))
    expect(updatePermit.mock.calls[0]![2]).toMatchObject({
      issuing_agency: null, identifiers: {},
      conditions: [{ id: 'c-1', text: 'Sample each outfall quarterly', frequency: 'Quarterly', ref: 'Part III.A' }],
    })
  })

  it('shows the API\'s words when the edit is refused', async () => {
    updatePermit.mockRejectedValue(new ApiError('dup', 409, 'duplicate_permit_number', ['This site already has a permit with that number for this program.']))
    const form = await openEdit()
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))
    expect(await form.findByRole('alert')).toHaveTextContent('This site already has a permit with that number for this program.')
  })
})

describe('deleting a permit', () => {
  async function askToDelete() {
    render(<EnvironmentalPermits />)
    await listLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Delete Industrial General Permit CAS000001' }))
    return within(await screen.findByRole('dialog', { name: 'Delete Industrial General Permit CAS000001?' }))
  }

  it('asks first, and says the renewal deadline is dismissed', async () => {
    const dialog = await askToDelete()
    expect(dialog.getByText(/renewal deadline on the calendar is dismissed/i)).toBeInTheDocument()
    expect(deletePermit).not.toHaveBeenCalled()
  })

  it('deletes nothing when the question is answered with Cancel', async () => {
    const dialog = await askToDelete()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deletePermit).not.toHaveBeenCalled()
  })

  it('deletes nothing when the question is dismissed with Escape', async () => {
    await askToDelete()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deletePermit).not.toHaveBeenCalled()
  })

  it('deletes that one permit when confirmed, then reloads the list', async () => {
    deletePermit.mockResolvedValue({ ok: true })
    const dialog = await askToDelete()
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permit' }))

    await waitFor(() => expect(deletePermit).toHaveBeenCalledWith(AT_SITE, 'p-expiring'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listPermits).toHaveBeenCalledTimes(2))
  })

  it('keeps the question open and says why when the delete fails', async () => {
    deletePermit.mockRejectedValue(new ApiError('That record no longer exists.', 404, 'not_found', []))
    const dialog = await askToDelete()
    await userEvent.click(dialog.getByRole('button', { name: 'Delete permit' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('That record no longer exists.')
    expect(listPermits).toHaveBeenCalledTimes(1)
  })
})
