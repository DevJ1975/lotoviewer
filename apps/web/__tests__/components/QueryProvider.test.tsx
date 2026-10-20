import { vi, describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

// The cache is keyed by tenant, not user. These tests pin the guard that
// stops a second user on a shared tablet from seeing the first user's
// cached rows: a change of signed-in user must empty the cache.

let currentUserId: string | null = 'user-a'
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ userId: currentUserId }),
}))

import { QueryProvider } from '@/components/QueryProvider'

function renderWithClientProbe() {
  let client: QueryClient | undefined
  function Probe() {
    client = useQueryClient()
    return null
  }
  const ui = () => <QueryProvider><Probe /></QueryProvider>
  const view = render(ui())
  return { getClient: () => client!, rerender: () => view.rerender(ui()) }
}

describe('QueryProvider', () => {
  it('clears cached data when the signed-in user changes', () => {
    currentUserId = 'user-a'
    const { getClient, rerender } = renderWithClientProbe()
    getClient().setQueryData(['risks', 'list', 't1', ''], { risks: [{ id: 'r1' }], total: 1 })

    currentUserId = 'user-b'
    rerender()

    expect(getClient().getQueryData(['risks', 'list', 't1', ''])).toBeUndefined()
  })

  it('clears cached data on sign-out', () => {
    currentUserId = 'user-a'
    const { getClient, rerender } = renderWithClientProbe()
    getClient().setQueryData(['risks', 'list', 't1', ''], { risks: [], total: 0 })

    currentUserId = null
    rerender()

    expect(getClient().getQueryData(['risks', 'list', 't1', ''])).toBeUndefined()
  })

  it('keeps cached data while the same user stays signed in', () => {
    currentUserId = 'user-a'
    const { getClient, rerender } = renderWithClientProbe()
    getClient().setQueryData(['risks', 'list', 't1', ''], { risks: [], total: 0 })

    rerender()

    expect(getClient().getQueryData(['risks', 'list', 't1', ''])).toEqual({ risks: [], total: 0 })
  })
})
