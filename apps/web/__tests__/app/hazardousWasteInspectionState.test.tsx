import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Facility } from '@soteria/core/types'

// The new-inspection form asks the federal checks everywhere and adds a state's own checks for
// an area at a site in that state. A state check shows the rule it comes from and what a
// reviewer still has to confirm, because the content is a draft.

const ROUTER = { push: vi.fn(), refresh: vi.fn() }
const SEARCH_PARAMS = new URLSearchParams()
vi.mock('next/navigation', () => ({ useRouter: () => ROUTER, useSearchParams: () => SEARCH_PARAMS }))
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }))
const TENANT = { tenant: { id: 'tenant-1' } }
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => TENANT }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) } } }))
vi.mock('../../app/hazardous-waste/inspections/_components/EvidencePhotos', () => ({ EvidencePhotos: () => null }))

const site = (id: string, state: string | null): Facility => ({
  id, tenant_id: 'tenant-1', name: id, code: null, address: null, city: null, state,
  is_primary: false, status: 'active', settings: {}, created_at: '', updated_at: '',
})
const SITE_CA = site('site-ca', 'CA')
const SITE_TX = site('site-tx', 'TX')
const SITE_OR = site('site-or', 'OR')
let facilityState: { available: Facility[]; facility: Facility | null }
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => facilityState }))

import NewHazardousWasteInspectionPage from '@/app/hazardous-waste/inspections/new/page'

const area = (id: string, facility_id: string | null, area_type = 'central_accumulation') => ({
  id, tenant_id: 'tenant-1', facility_id, name: `Area ${id}`, area_type, location_notes: null, weekly_cadence_days: 7,
  photo_urls: [], archived_at: null, created_at: '', updated_at: '', created_by: null, updated_by: null,
})

function showAreas(...areas: ReturnType<typeof area>[]) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ areas }) })))
}
async function pick(areaId: string) {
  const select = await screen.findByRole('combobox')
  await userEvent.selectOptions(select, areaId)
}

beforeEach(() => {
  facilityState = { available: [SITE_CA, SITE_TX, SITE_OR], facility: null }
})

describe('the new-inspection form', () => {
  it('asks only the federal checks for an area at a site in a state with no additions', async () => {
    showAreas(area('a1', 'site-or'))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    expect(await screen.findByText(/Container is closed except when adding or removing waste/)).toBeInTheDocument()
    expect(screen.queryByText(/^California:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Texas:/)).not.toBeInTheDocument()
  })

  it('adds the California checks for an area at a California site, with their rule and review note', async () => {
    showAreas(area('a1', 'site-ca'))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    expect(await screen.findByText(/California: the label also shows the composition/)).toBeInTheDocument()
    expect(screen.getByText(/California: extremely hazardous waste is identified/)).toBeInTheDocument()
    expect(screen.getByText(/22 CCR §66262\.32/)).toBeInTheDocument()
    expect(screen.getAllByText(/Draft, to be confirmed:/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/^Texas:/)).not.toBeInTheDocument()
  })

  it('adds the Texas checks for an area at a Texas site, and not the California ones', async () => {
    showAreas(area('a1', 'site-tx'))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    expect(await screen.findByText(/Texas: each container's waste is classified/)).toBeInTheDocument()
    expect(screen.queryByText(/California:/)).not.toBeInTheDocument()
  })

  it('follows the area\'s own site, not the site currently selected', async () => {
    facilityState = { available: [SITE_CA, SITE_TX, SITE_OR], facility: SITE_TX }
    showAreas(area('a1', 'site-ca'))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    expect(await screen.findByText(/California: the label also shows/)).toBeInTheDocument()
    expect(screen.queryByText(/^Texas:/)).not.toBeInTheDocument()
  })

  it('falls back to the active site for a shared area that belongs to no site', async () => {
    facilityState = { available: [SITE_CA, SITE_TX], facility: SITE_TX }
    showAreas(area('a1', null))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    expect(await screen.findByText(/Texas: each container's waste is classified/)).toBeInTheDocument()
  })

  it('shows the federal checks alone when no site is known at all', async () => {
    facilityState = { available: [], facility: null }
    showAreas(area('a1', null))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    await waitFor(() => expect(screen.getByText(/Container is closed except when adding or removing waste/)).toBeInTheDocument())
    expect(screen.queryByText(/California:|Texas:/)).not.toBeInTheDocument()
  })

  it('does not show a check meant for another kind of area', async () => {
    showAreas(area('a1', 'site-ca', 'satellite_accumulation'))
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    expect(await screen.findByText(/California: the label also shows/)).toBeInTheDocument()
    expect(screen.queryByText(/California: only recognized universal waste categories/)).not.toBeInTheDocument()
  })

  it('submits a finding for every check shown, state checks included', async () => {
    showAreas(area('a1', 'site-ca'))
    const fetchMock = vi.mocked(fetch)
    render(<NewHazardousWasteInspectionPage />)
    await pick('a1')
    await screen.findByText(/California: the label also shows/)
    for (const button of screen.getAllByRole('button', { name: /^pass$/i })) await userEvent.click(button)
    fetchMock.mockImplementation(async (_url, init) => (
      init?.method === 'POST' ? ({ ok: true, json: async () => ({}) }) : ({ ok: true, json: async () => ({ areas: [] }) })
    ) as Response)
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true))
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!
    const sent = JSON.parse(String(post[1]!.body)) as { findings: Array<{ check_id: string; status: string }> }
    expect(sent.findings.map(f => f.check_id)).toEqual(expect.arrayContaining(['closed-container', 'ca-label-contents', 'ca-ehw-identified']))
    expect(sent.findings.every(f => f.status === 'pass')).toBe(true)
  })
})
