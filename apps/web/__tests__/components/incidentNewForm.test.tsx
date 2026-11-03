import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// /incidents/new, driven the way a worker's thumb would. The behaviors
// pinned here are the ones a rushed reporter can get wrong silently: an
// injury that files as "No injury", and a form that never says to get help.

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: pushMock }) }))
vi.mock('@/components/TenantProvider', () => ({ useTenant: () => ({ tenant: { id: 'tenant-1' } }) }))
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

import NewIncidentPage from '@/app/incidents/new/page'

const fetchMock = vi.fn()

beforeEach(() => {
  pushMock.mockReset()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ report: { id: 'inc-1' } }), { status: 201 }),
  )
  vi.stubGlobal('fetch', fetchMock)
})

async function fillInjury(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(/^Injury \/ illness/))
  await user.type(screen.getByPlaceholderText(/Stick to what you saw/i), 'Hand caught in the guard.')
}

function postedBody(): Record<string, unknown> {
  return JSON.parse(String(fetchMock.mock.calls[0][1].body))
}

describe('/incidents/new — "get help first" notice', () => {
  it('is on screen before the reporter picks anything', () => {
    render(<NewIncidentPage />)
    expect(screen.getByRole('note')).toHaveTextContent('Someone hurt or in danger right now?')
  })
})

describe('/incidents/new — an injury is never filed as "No injury" by default', () => {
  it('starts with no severity chosen once the type is Injury / illness', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await user.click(screen.getByLabelText(/^Injury \/ illness/))

    const severityOptions = document.querySelectorAll<HTMLInputElement>('input[name="severity_actual"]')
    expect(severityOptions).toHaveLength(6)
    for (const option of severityOptions) expect(option).not.toBeChecked()
  })

  it('refuses to file an injury until the reporter says what happened to the person', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await fillInjury(user)

    await user.click(screen.getByRole('button', { name: 'File incident' }))

    expect(await screen.findByText(/Pick what happened to the person/)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still lets the reporter say nobody was hurt, explicitly', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await fillInjury(user)

    await user.click(screen.getByLabelText(/^No injury/))
    await user.click(screen.getByRole('button', { name: 'File incident' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody().severity_actual).toBe('none')
  })

  it('files the severity the reporter chose', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await fillInjury(user)

    await user.click(screen.getByLabelText(/^Medical treatment/))
    await user.click(screen.getByRole('button', { name: 'File incident' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody().severity_actual).toBe('medical')
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/incidents/inc-1'))
  })

  it('flags hospital stay, amputation and eye loss on the medical option', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await user.click(screen.getByLabelText(/^Injury \/ illness/))

    expect(screen.getByText(/Hospital stay, amputation or lost an eye\? Tell your supervisor now/)).toBeInTheDocument()
  })
})

describe('/incidents/new — types with no injury question still file without one', () => {
  it('files a property-damage report with severity none and no extra step', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await user.click(screen.getByLabelText(/^Property damage/))
    await user.type(screen.getByPlaceholderText(/Stick to what you saw/i), 'Forklift clipped the rack.')

    await user.click(screen.getByRole('button', { name: 'File incident' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(postedBody().severity_actual).toBe('none')
  })
})

describe('/incidents/new — severity potential is described in words', () => {
  it('offers each band with what it means, not just a label', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await user.click(screen.getByLabelText(/^Near miss/))

    expect(screen.getByRole('option', { name: /^Extreme: Could have killed someone or changed their life/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /^High: Could have put someone in the hospital or off work/ })).toBeInTheDocument()
  })
})

describe('/incidents/new — spill guidance', () => {
  it('tells the reporter what to do about a spill reaching a drain, not a roadmap phase', async () => {
    const user = userEvent.setup()
    render(<NewIncidentPage />)
    await user.click(screen.getByLabelText(/^Environmental spill/))

    expect(screen.getByText(/reached a drain, soil or water/i)).toBeInTheDocument()
    expect(screen.queryByText(/Phase 6/)).not.toBeInTheDocument()
  })
})
