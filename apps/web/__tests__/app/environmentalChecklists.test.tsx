import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PermitRow } from '@/lib/environmental/client'
import type { ChecklistTemplateRow, Outfall, SiteDetail } from '@/lib/environmental/complianceClient'

// The checklists list is where a person picks what to inspect. When a checklist is run
// against one permit or one outfall, the choices come from the site: the permits are the
// EMS permit vault's, read through the EMS client, and only those in force are a new subject.

const listChecklists = vi.fn()
const listOutfalls = vi.fn()
const startChecklist = vi.fn()
const listPermits = vi.fn()
const push = vi.fn()
vi.mock('@/lib/environmental/complianceClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/complianceClient')>('@/lib/environmental/complianceClient')
  return {
    ...actual,
    listChecklists: (...a: unknown[]) => listChecklists(...a),
    listOutfalls: (...a: unknown[]) => listOutfalls(...a),
    startChecklist: (...a: unknown[]) => startChecklist(...a),
  }
})
vi.mock('@/lib/environmental/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/client')>('@/lib/environmental/client')
  return { ...actual, listPermits: (...a: unknown[]) => listPermits(...a) }
})

// Stable objects, as the real hooks return them: a new one on every render would re-run the page's effects.
const AT_SITE = { tenantId: 'tenant-1', facilityId: 'site-1' }
const ENV = { scope: AT_SITE, facilityId: 'site-1', facilityName: 'Plant 1', canAdmin: false, ready: true }
const SITE = {
  facility: { id: 'site-1', name: 'Plant 1', state: 'TX' },
  jurisdiction: { chain: ['federal', 'TX'], state: 'TX', status: 'supported' },
  notice: null,
  packs: [{ jurisdiction: 'federal', version: '1', status: 'draft', last_verified: null }],
} as unknown as SiteDetail
const SITE_STATE = { site: SITE, loading: false, error: null, reload: vi.fn(), setSite: vi.fn() }
vi.mock('@/lib/environmental/useEnvironmental', () => ({
  useEnvironmentalScope: () => ENV,
  useEnvironmentalSite: () => SITE_STATE,
}))
const ROUTER = { push }
const SEARCH_PARAMS = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ROUTER, useSearchParams: () => SEARCH_PARAMS }))
const FACILITIES = { available: [{ id: 'site-1', name: 'Plant 1' }], switchFacility: vi.fn() }
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => FACILITIES }))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => <header><h1>{title}</h1><p>{description}</p></header>,
}))

import ChecklistsPage from '@/app/environmental/compliance/checklists/page'

const template = (over: Partial<ChecklistTemplateRow>): ChecklistTemplateRow => ({
  library_key: 'k', name: 'Checklist', description: 'What it checks.', program: 'stormwater', subject_type: 'facility',
  cadence: 'quarterly', item_count: 8, source: 'library', template_id: null, last_completed_on: null, due_status: 'never', due_on: null, ...over,
})
const PERMIT_CHECKLIST = template({ library_key: 'permit-walk', name: 'Permit compliance walk', subject_type: 'permit' })
const OUTFALL_CHECKLIST = template({ library_key: 'outfall-visual', name: 'Outfall visual assessment', subject_type: 'outfall', program: 'outfall' })
const SITE_CHECKLIST = template({ library_key: 'site-walk', name: 'Site walk' })

const permit = (over: Partial<PermitRow> = {}): PermitRow => ({
  id: 'p-1', facility_id: 'site-1', program: 'stormwater', instrument: 'permit', title: 'Industrial General Permit',
  agency: 'State Water Board', permit_number: 'CAS000001', jurisdiction: 'state:CA', holder_of_record: 'Acme Foods LLC',
  issued_on: '2024-01-01', expires_on: '2029-01-01', renewal_application_due_on: null, renewal_submitted_on: null,
  business_critical: false, owner_user_id: null, notes: null, retired_at: null, retired_reason: null,
  last_reviewed_at: null, next_review_due: '2027-01-01', standing: 'current', renewal_deadline: '2029-01-01', escalation: null,
  holder_mismatch: null, conditions_open: 0, conditions_overdue: 0, ...over,
})
const outfall = (over: Partial<Outfall>): Outfall => ({
  id: 'o-1', facility_id: 'site-1', permit_id: null, code: 'OF-001', name: null, receiving_water: null, drainage_area: null,
  latitude: null, longitude: null, outfall_type: 'stormwater', substantially_identical_to: null, is_sampling_point: false,
  status: 'active', photo_path: null, notes: null, ...over,
})

beforeEach(() => {
  for (const fn of [listChecklists, listOutfalls, startChecklist, listPermits, push]) fn.mockReset()
  listChecklists.mockResolvedValue({ templates: [SITE_CHECKLIST, PERMIT_CHECKLIST, OUTFALL_CHECKLIST], runs: [] })
  listOutfalls.mockResolvedValue({ outfalls: [] })
  listPermits.mockResolvedValue({ permits: [] })
})

async function chooseSubjectFor(checklist: string) {
  render(<ChecklistsPage />)
  const card = (await screen.findByRole('heading', { name: checklist })).closest('article')!
  await userEvent.click(card.querySelector('button')!)
  return card
}

describe('a checklist run against a permit', () => {
  it('reads the permits in force from the EMS permit vault', async () => {
    await chooseSubjectFor('Permit compliance walk')
    await waitFor(() => expect(listPermits).toHaveBeenCalledWith('tenant-1', { status: 'active' }))
  })

  it('offers the site\'s permits by title and number, and no other site\'s', async () => {
    listPermits.mockResolvedValue({ permits: [
      permit({ id: 'p-2', title: 'Wastewater Discharge', permit_number: 'W-7' }),
      permit({ id: 'p-9', facility_id: 'site-2', title: 'Other Plant Permit', permit_number: 'X-1' }),
      permit({ id: 'p-3', title: 'Air registration', permit_number: null }),
      permit({ id: 'p-1' }),
    ] })
    const card = await chooseSubjectFor('Permit compliance walk')

    const select = await screen.findByLabelText('Which permit')
    expect(card).toContainElement(select)
    expect(Array.from(select.querySelectorAll('option')).map(o => o.textContent)).toEqual([
      'Choose…', 'Air registration', 'Industrial General Permit CAS000001', 'Wastewater Discharge W-7',
    ])
  })

  it('starts the checklist against the permit that was chosen', async () => {
    listPermits.mockResolvedValue({ permits: [permit({ id: 'p-1' }), permit({ id: 'p-2', title: 'Wastewater Discharge', permit_number: 'W-7' })] })
    startChecklist.mockResolvedValue({ inspection_id: 'run-9', resumed: false })
    const card = await chooseSubjectFor('Permit compliance walk')

    await userEvent.selectOptions(await screen.findByLabelText('Which permit'), 'p-2')
    await userEvent.click(card.querySelector('button')!)

    await waitFor(() => expect(startChecklist).toHaveBeenCalledWith(AT_SITE, { library_key: 'permit-walk', subject_id: 'p-2' }))
    expect(push).toHaveBeenCalledWith('/environmental/compliance/checklists/run-9')
  })

  it('sends the person to the Permits register when the site has no permit in force', async () => {
    await chooseSubjectFor('Permit compliance walk')
    const link = await screen.findByRole('link', { name: 'Permits' })
    expect(link).toHaveAttribute('href', '/environmental/permits')
  })

  it('does not ask for permits when no checklist here is run against one', async () => {
    listChecklists.mockResolvedValue({ templates: [SITE_CHECKLIST], runs: [] })
    render(<ChecklistsPage />)
    await screen.findByRole('heading', { name: 'Site walk' })
    expect(listPermits).not.toHaveBeenCalled()
  })
})

describe('a checklist run against an outfall', () => {
  it('offers the outfalls that are still on the site', async () => {
    listOutfalls.mockResolvedValue({ outfalls: [
      outfall({ id: 'o-1', code: 'OF-001', name: 'North apron' }),
      outfall({ id: 'o-2', code: 'OF-002', status: 'removed' }),
      outfall({ id: 'o-3', code: 'OF-003', status: 'inactive' }),
    ] })
    await chooseSubjectFor('Outfall visual assessment')

    const select = await screen.findByLabelText('Which outfall')
    expect(Array.from(select.querySelectorAll('option')).map(o => o.textContent)).toEqual([
      'Choose…', 'Outfall OF-001: North apron', 'Outfall OF-003',
    ])
  })

  it('sends the person to the Outfalls page when the site has none', async () => {
    await chooseSubjectFor('Outfall visual assessment')
    const link = await screen.findByRole('link', { name: 'Outfalls' })
    expect(link).toHaveAttribute('href', '/environmental/compliance/outfalls')
  })
})
