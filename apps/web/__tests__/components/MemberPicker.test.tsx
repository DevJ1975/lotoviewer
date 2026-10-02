import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

// The member picker is shared by the risk wizard and the environmental
// process map, which mounts one per process. Pickers on a page share one
// member fetch; a failed fetch is retried; an open list closes from the
// keyboard and on a press elsewhere, not only on mouse-leave.

const tenant = vi.hoisted(() => ({ id: 'tenant-0' }))
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenant: { id: tenant.id } }) }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }))

import MemberPicker from '@/app/risk/_components/wizard/MemberPicker'

const MEMBERS = [{ user_id: 'u-1', role: 'admin', email: 'lead@example.test', full_name: 'Demo EHS Lead' }]
const ok = () => new Response(JSON.stringify({ members: MEMBERS }), { status: 200 })

let fetchMock: ReturnType<typeof vi.fn>
let tenantCounter = 0
beforeEach(() => {
  tenant.id = `tenant-${++tenantCounter}`   // the cache is per tenant and per module, so each test starts cold
  fetchMock = vi.fn(async () => ok())
  vi.stubGlobal('fetch', fetchMock)
})

describe('MemberPicker', () => {
  it('lets pickers that mount together share one member fetch', async () => {
    render(<>{[1, 2, 3, 4].map(n => <MemberPicker key={n} value="u-1" onChange={() => {}} />)}</>)
    expect(await screen.findAllByText('Demo EHS Lead')).toHaveLength(4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries after a failed fetch instead of caching the failure', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Service unavailable' }), { status: 503 }))
    const first = render(<MemberPicker value="" onChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    first.unmount()

    render(<MemberPicker value="u-1" onChange={() => {}} />)
    expect(await screen.findByText('Demo EHS Lead')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says whether its list is open, and closes it on Escape', async () => {
    render(<MemberPicker value="" onChange={() => {}} />)
    const trigger = screen.getByRole('button', { name: 'Unassigned' })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findByText('Demo EHS Lead')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('Demo EHS Lead')).toBeNull())
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('closes its list on a press elsewhere, but not on a press inside it', async () => {
    render(<><MemberPicker value="" onChange={() => {}} /><p>Elsewhere</p></>)
    fireEvent.click(screen.getByRole('button', { name: 'Unassigned' }))
    const option = await screen.findByText('Demo EHS Lead')
    fireEvent.pointerDown(option)
    expect(screen.getByText('Demo EHS Lead')).toBeInTheDocument()
    fireEvent.pointerDown(screen.getByText('Elsewhere'))
    await waitFor(() => expect(screen.queryByText('Demo EHS Lead')).toBeNull())
  })

  it('hands the chosen member to its owner, and an empty value on unassign', async () => {
    const onChange = vi.fn()
    render(<MemberPicker value="u-1" onChange={onChange} />)
    fireEvent.click(await screen.findByRole('button', { name: /Demo EHS Lead/ }))
    fireEvent.click(screen.getAllByText('Demo EHS Lead').at(-1)!)
    expect(onChange).toHaveBeenLastCalledWith('u-1')
    fireEvent.click(screen.getByRole('button', { name: 'Unassign' }))
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})
