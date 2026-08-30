import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// A signed-in session, so the banner actually fires its fetch.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}))

import { ReleaseNotesBanner } from '@/components/ReleaseNotesBanner'

const SEEN_KEY = 'soteria.releaseNote.seenId'
const DAY = 86_400_000

function note(over: Record<string, unknown> = {}) {
  return {
    id:           42,
    version:      'v1.17.0',
    title:        'Regulatory Watch now covers Cal/OSHA',
    body_md:      'A new **Coming Up** panel shows what is ahead.',
    published_at: new Date(Date.now() - DAY).toISOString(),   // 1 day old
    ...over,
  }
}

function mockLatest(payload: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => payload,
  })))
}

describe('ReleaseNotesBanner', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('shows a freshly published note', async () => {
    mockLatest({ note: note(), windowDays: 7 })
    render(<ReleaseNotesBanner />)
    expect(await screen.findByText('Regulatory Watch now covers Cal/OSHA')).toBeInTheDocument()
    expect(screen.getByText('v1.17.0')).toBeInTheDocument()
  })

  it('renders the body markdown as bold rather than literal asterisks', async () => {
    mockLatest({ note: note(), windowDays: 7 })
    render(<ReleaseNotesBanner />)
    expect(await screen.findByText('Coming Up')).toBeInTheDocument()   // <strong>
    expect(screen.queryByText(/\*\*/)).toBeNull()
  })

  // Exit #1 — the user acknowledges it.
  it('disappears when dismissed, and remembers that across mounts', async () => {
    mockLatest({ note: note(), windowDays: 7 })
    const { unmount } = render(<ReleaseNotesBanner />)
    await screen.findByText('Regulatory Watch now covers Cal/OSHA')

    await userEvent.click(screen.getByLabelText('Dismiss'))
    await waitFor(() =>
      expect(screen.queryByText('Regulatory Watch now covers Cal/OSHA')).toBeNull())
    expect(localStorage.getItem(SEEN_KEY)).toBe('42')

    // Remounting (a page navigation) must not bring it back.
    unmount()
    const { container } = render(<ReleaseNotesBanner />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  // Exit #2 — a week passes. This is the regression the window exists for:
  // before it, a note nobody dismissed stayed on screen indefinitely.
  it('stays hidden for a note older than the window, even if never dismissed', async () => {
    mockLatest({ note: note({ published_at: new Date(Date.now() - 8 * DAY).toISOString() }), windowDays: 7 })
    const { container } = render(<ReleaseNotesBanner />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
    expect(localStorage.getItem(SEEN_KEY)).toBeNull()   // never dismissed
  })

  it('honours a window supplied by the server', async () => {
    // 10 days old but a 14-day window — still inside it.
    mockLatest({ note: note({ published_at: new Date(Date.now() - 10 * DAY).toISOString() }), windowDays: 14 })
    render(<ReleaseNotesBanner />)
    expect(await screen.findByText('Regulatory Watch now covers Cal/OSHA')).toBeInTheDocument()
  })

  it('stays hidden for a note already dismissed on a previous visit', async () => {
    localStorage.setItem(SEEN_KEY, '42')
    mockLatest({ note: note(), windowDays: 7 })
    const { container } = render(<ReleaseNotesBanner />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  // Dismissing note 42 must not suppress note 43.
  it('resurfaces for a newer note than the one dismissed', async () => {
    localStorage.setItem(SEEN_KEY, '42')
    mockLatest({ note: note({ id: 43, title: 'Something newer' }), windowDays: 7 })
    render(<ReleaseNotesBanner />)
    expect(await screen.findByText('Something newer')).toBeInTheDocument()
  })

  it('renders nothing when there is no published note', async () => {
    mockLatest({ note: null, windowDays: 7 })
    const { container } = render(<ReleaseNotesBanner />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
