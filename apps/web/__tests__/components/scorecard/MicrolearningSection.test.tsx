import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MicrolearningSection } from '@/components/scorecard/MicrolearningSection'
import { microlearningFixture } from '../../fixtures/microlearning'

// The section shows what management asked for (how many, which modules, who
// is current), hides itself when STRIKE is off, and never fails silently.

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }) } },
}))
vi.mock('recharts', async importOriginal => {
  const actual = await importOriginal<typeof import('recharts')>()
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }
})

function stubFetch(...responses: { ok: boolean; status?: number; body: unknown }[]) {
  const fetchMock = vi.fn()
  for (const r of responses) fetchMock.mockResolvedValueOnce({ ok: r.ok, status: r.status ?? 200, json: async () => r.body })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => { vi.unstubAllGlobals() })
afterEach(() => { cleanup() })

describe('MicrolearningSection', () => {
  it('asks for the chosen window as the active tenant', async () => {
    const fetchMock = stubFetch({ ok: true, body: { summary: microlearningFixture() } })
    render(<MicrolearningSection tenantId="t1" windowDays={90} />)
    await screen.findByText('Which modules')
    expect(fetchMock).toHaveBeenCalledWith('/api/scorecard/microlearning?window=90', {
      headers: { 'x-active-tenant': 't1', authorization: 'Bearer tok' },
    })
  })

  it('shows how many were completed, which modules, and the language and delivery split', async () => {
    stubFetch({ ok: true, body: { summary: microlearningFixture() } })
    render(<MicrolearningSection tenantId="t1" windowDays={30} />)
    expect(await screen.findByLabelText('Completed: 3, 3 people trained')).toBeInTheDocument()
    expect(screen.getByText('LOTO 101: Control of Hazardous Energy')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'LOTO 101: Control of Hazardous Energy: 2 completions' })).toBeInTheDocument()
    expect(screen.getByText(/Spanish:/)).toBeInTheDocument()
    expect(screen.getByText(/Supervisor-verified \(ADA\):/)).toBeInTheDocument()
  })

  it('offers the trend as a table for screen readers', async () => {
    stubFetch({ ok: true, body: { summary: microlearningFixture() } })
    render(<MicrolearningSection tenantId="t1" windowDays={30} />)
    expect(await screen.findByRole('table', { name: 'Completions per day' })).toBeInTheDocument()
  })

  it('renders nothing when STRIKE is off for the tenant', async () => {
    const fetchMock = stubFetch({ ok: true, body: { summary: null } })
    const { container } = render(<MicrolearningSection tenantId="t1" windowDays={30} />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('says when it could not load, and retries on request', async () => {
    stubFetch({ ok: false, status: 500, body: { error: 'boom' } }, { ok: true, body: { summary: microlearningFixture() } })
    render(<MicrolearningSection tenantId="t1" windowDays={30} />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load microlearning: boom")
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Which modules')).toBeInTheDocument()
  })
})
