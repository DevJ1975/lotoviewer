import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { supabase } from '@/lib/supabase'
import DepartmentsPage from '@/app/departments/page'

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}))

type Row = { department: string; photo_status: 'missing' | 'partial' | 'complete' }

function makeChain(data: unknown[]) {
  const chain: Record<string, unknown> = {
    then: (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data, error: null }).then(resolve, reject),
  }
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq     = vi.fn().mockReturnValue(chain)
  chain.order  = vi.fn().mockReturnValue(chain)
  chain.limit  = vi.fn().mockReturnValue(chain)
  return chain
}

const mockRows: Row[] = [
  { department: 'Electrical', photo_status: 'complete' },
  { department: 'Electrical', photo_status: 'complete' },
  { department: 'Mechanical', photo_status: 'missing' },
  { department: 'Mechanical', photo_status: 'partial' },
  { department: 'Maintenance', photo_status: 'missing' },
]

describe('DepartmentsPage', () => {
  beforeEach(() => {
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'loto_reviews') return makeChain([]) as unknown as ReturnType<typeof supabase.from>
      return makeChain(mockRows) as unknown as ReturnType<typeof supabase.from>
    })
  })

  it('shows loading spinner while fetching', () => {
    const hangingChain: Record<string, unknown> = { then: () => new Promise(() => {}) }
    hangingChain.select = vi.fn().mockReturnValue(hangingChain)
    hangingChain.order  = vi.fn().mockReturnValue(hangingChain)
    hangingChain.limit  = vi.fn().mockReturnValue(hangingChain)
    vi.mocked(supabase.from).mockReturnValue(hangingChain as unknown as ReturnType<typeof supabase.from>)
    render(<DepartmentsPage />)
    expect(document.querySelector('.animate-spin')).toBeInTheDocument()
  })

  it('shows page heading after load', async () => {
    render(<DepartmentsPage />)
    await waitFor(() => screen.getByText('Departments'))
  })

  it('renders a card for each department', async () => {
    render(<DepartmentsPage />)
    await waitFor(() => screen.getByText('Electrical'))
    expect(screen.getByText('Mechanical')).toBeInTheDocument()
    expect(screen.getByText('Maintenance')).toBeInTheDocument()
  })

  it('shows department count in subtitle', async () => {
    render(<DepartmentsPage />)
    await waitFor(() => screen.getByText(/3 departments/))
  })

  it('links each dept card to the correct URL', async () => {
    render(<DepartmentsPage />)
    await waitFor(() => screen.getByText('Electrical'))
    const links = screen.getAllByRole('link')
    const hrefs = links.map(l => l.getAttribute('href'))
    expect(hrefs).toContain('/departments/Electrical')
    expect(hrefs).toContain('/departments/Mechanical')
  })

  it('shows percentage for each department', async () => {
    render(<DepartmentsPage />)
    await waitFor(() => screen.getByText('Electrical'))
    // Electrical: 2 complete / 2 total = 100%
    expect(screen.getByText('100%')).toBeInTheDocument()
    // Mechanical and Maintenance are both 0% — two occurrences expected
    expect(screen.getAllByText('0%')).toHaveLength(2)
  })

  it('shows empty state gracefully when no data', async () => {
    vi.mocked(supabase.from).mockImplementation(() =>
      makeChain([]) as unknown as ReturnType<typeof supabase.from>
    )
    render(<DepartmentsPage />)
    await waitFor(() => screen.getByText(/0 departments/))
  })
})
