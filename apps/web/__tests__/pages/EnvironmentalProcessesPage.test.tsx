import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// /environmental/processes (clauses 4.4 and 5.3). The map lists every EMS
// process, those kept outside the platform included; members can see who
// owns what, because 5.3 asks for responsibilities to be communicated;
// admins assign them, and a departed owner is flagged, never shown as
// "unassigned". The real MemberPicker runs; only the network is stubbed.

const access = vi.hoisted(() => ({ role: 'admin' }))
const api = vi.hoisted(() => ({ getResponsibilities: vi.fn(), assignResponsibility: vi.fn() }))

vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({ tenantId: 'tenant-1', tenant: { id: 'tenant-1' }, role: access.role }),
}))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ profile: { is_superadmin: false } }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import EmsProcessesPage from '@/app/environmental/processes/page'
import { EmsApiError } from '@/lib/environmental/client'

const MEMBERS = [
  { user_id: 'u-1', role: 'owner', email: 'plant.manager@example.test', full_name: 'Demo Plant Manager' },
  { user_id: 'u-2', role: 'member', email: 'ehs.lead@example.test', full_name: 'Demo EHS Lead' },
]

const held = (key: string, owner: string | null) => ({ responsibility_key: key, owner_user_id: owner, assigned_by: 'u-1', updated_at: '' })

beforeEach(() => {
  access.role = 'admin'
  for (const fn of Object.values(api)) fn.mockReset()
  api.getResponsibilities.mockResolvedValue({
    responsibilities: [held('system_conformity', 'u-1'), held('aspects', 'u-2'), held('policy', 'u-gone')],
    coverage: { rolesUnassigned: 1, processesUnassigned: 12 },
    health: 'red',
  })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ members: MEMBERS }), { status: 200 })))
})

const ownerGroup = (name: string) => within(screen.getByRole('group', { name: `Owner of ${name}` }))

describe('/environmental/processes', () => {
  it('maps both clause 5.3 roles and every process, including those kept outside the platform', async () => {
    render(<EmsProcessesPage />)
    expect(await screen.findByText('Ensuring the EMS conforms to ISO 14001')).toBeInTheDocument()
    expect(screen.getByText('Reporting EMS performance to top management')).toBeInTheDocument()
    expect(screen.getAllByRole('group', { name: /^Owner of / })).toHaveLength(16)
    expect(screen.getAllByText('Kept outside the platform for now.')).toHaveLength(6)
    expect(screen.getByText('Feeds: Objectives, monitoring and measurement, Operational control, Emergency preparedness and response'))
      .toBeInTheDocument()
  })

  it('shows the light and what keeps it from green', async () => {
    render(<EmsProcessesPage />)
    const strip = await screen.findByRole('region', { name: 'Responsibilities register health' })
    expect(within(strip).getByText('Missing')).toBeInTheDocument()
    expect(within(strip).getByText('12')).toBeInTheDocument()
  })

  it('tells a member who owns what, without letting them change it', async () => {
    access.role = 'member'
    render(<EmsProcessesPage />)
    await screen.findByText('Ensuring the EMS conforms to ISO 14001')
    expect(await ownerGroup('Environmental aspects').findByText('Demo EHS Lead')).toBeInTheDocument()
    expect(ownerGroup('Ensuring the EMS conforms to ISO 14001').getByText('Demo Plant Manager')).toBeInTheDocument()
    expect(ownerGroup('Compliance obligations').getByText('No owner')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /No owner|Demo/ })).toEqual([])
  })

  it('flags an owner who has left the organization instead of showing them as unassigned', async () => {
    render(<EmsProcessesPage />)
    await screen.findByText('Environmental policy')
    expect(await ownerGroup('Environmental policy').findByText('The owner is no longer a member. Reassign it.')).toBeInTheDocument()
  })

  it('lets an admin assign a process to a member, then shows the saved map', async () => {
    api.assignResponsibility.mockResolvedValue({ responsibility: held('obligations', 'u-2') })
    render(<EmsProcessesPage />)
    await screen.findByText('Compliance obligations')
    const obligations = ownerGroup('Compliance obligations')
    fireEvent.click(obligations.getByRole('button', { name: 'No owner' }))
    fireEvent.click(await obligations.findByText('Demo EHS Lead'))
    await waitFor(() => expect(api.assignResponsibility).toHaveBeenCalledWith('tenant-1', 'obligations', 'u-2'))
    await waitFor(() => expect(api.getResponsibilities).toHaveBeenCalledTimes(2))
  })

  it('unassigns with the picker\'s clear button, sending null', async () => {
    api.assignResponsibility.mockResolvedValue({ responsibility: held('aspects', null) })
    render(<EmsProcessesPage />)
    await screen.findByText('Environmental aspects')
    fireEvent.click(await ownerGroup('Environmental aspects').findByRole('button', { name: 'Unassign' }))
    await waitFor(() => expect(api.assignResponsibility).toHaveBeenCalledWith('tenant-1', 'aspects', null))
  })

  it('shows a refused assignment on the row it belongs to', async () => {
    api.assignResponsibility.mockRejectedValue(new EmsApiError('owner_user_id is not a member of this organization', 400))
    render(<EmsProcessesPage />)
    await screen.findByText('Environmental aspects')
    fireEvent.click(await ownerGroup('Environmental aspects').findByRole('button', { name: 'Unassign' }))
    expect(await ownerGroup('Environmental aspects').findByRole('alert'))
      .toHaveTextContent('owner_user_id is not a member of this organization')
  })
})
