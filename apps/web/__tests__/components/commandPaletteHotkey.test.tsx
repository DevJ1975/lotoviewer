import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Regression guard for the ⌘K collision.
//
// Before this, GlobalSearch bound ⌘K *and* bare "/", CommandPalette bound ⌘K,
// and AppChrome mounted GlobalSearch twice (desktop + mobile) — three live
// window keydown listeners, every one calling preventDefault(). With focus on
// <body> they all fired. These tests assert the chord now has exactly one
// owner, and that the drawer/header triggers open it without re-binding it.

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({ tenant: { id: 't1', modules: {} }, tenantId: 't1' }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ profile: { is_superadmin: false } }),
}))

// No network from the palette's equipment lookup in these tests.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          or: () => ({ limit: () => Promise.resolve({ data: [] }) }),
        }),
      }),
    }),
  },
}))

import CommandPalette from '@/components/CommandPalette'
import SearchTrigger from '@/components/SearchTrigger'

describe('⌘K ownership', () => {
  let added: string[]

  beforeEach(() => {
    push.mockReset()
    added = []
    const realAdd = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, ...rest) => {
      added.push(String(type))
      return realAdd(type, ...rest)
    })
  })

  afterEach(() => vi.restoreAllMocks())

  it('registers exactly one global keydown listener', () => {
    render(<CommandPalette />)
    expect(added.filter(t => t === 'keydown')).toHaveLength(1)
  })

  it('opens on ⌘K', async () => {
    render(<CommandPalette />)
    expect(screen.queryByPlaceholderText(/Search pages, modules, and equipment/i)).toBeNull()

    await userEvent.keyboard('{Meta>}k{/Meta}')

    expect(await screen.findByPlaceholderText(/Search pages, modules, and equipment/i))
      .toBeInTheDocument()
  })

  // The old GlobalSearch stole bare "/" too, which meant a user could not type
  // a slash into any non-input surface without the header hijacking focus.
  it('ignores a bare "/" keypress', async () => {
    render(<CommandPalette />)
    await userEvent.keyboard('/')
    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/Search pages, modules, and equipment/i)).toBeNull())
  })
})

describe('SearchTrigger', () => {
  it('opens the palette via the shared event rather than binding the chord', async () => {
    const realAdd = window.addEventListener.bind(window)
    const seen: string[] = []
    vi.spyOn(window, 'addEventListener').mockImplementation((type, ...rest) => {
      seen.push(String(type))
      return realAdd(type, ...rest)
    })

    render(<><CommandPalette /><SearchTrigger /></>)
    // Still one keydown listener with the trigger also mounted.
    expect(seen.filter(t => t === 'keydown')).toHaveLength(1)

    await userEvent.click(screen.getByRole('button', { name: /search pages, modules, equipment/i }))
    expect(await screen.findByPlaceholderText(/Search pages, modules, and equipment/i))
      .toBeInTheDocument()

    vi.restoreAllMocks()
  })

  it('advertises the shortcut to assistive tech', () => {
    render(<SearchTrigger />)
    expect(screen.getByRole('button', { name: /search pages, modules, equipment/i }))
      .toHaveAttribute('aria-keyshortcuts', 'Meta+K Control+K')
  })
})
