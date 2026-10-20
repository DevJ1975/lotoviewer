'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '@/components/AuthProvider'

// Shared server-state cache for client pages. Query keys must include
// the tenant id so a tenant switch never serves another tenant's rows.
//
// The cache is dropped whenever the signed-in user changes: keys carry
// the tenant, not the user, so without this a second user on a shared
// plant-floor tablet could briefly see the first user's cached lists.

export function QueryProvider({ children }: { children: ReactNode }) {
  // One client per browser session; useState keeps it stable across
  // re-renders without sharing it between server requests.
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: 1,
      },
    },
  }))
  const { userId } = useAuth()

  useEffect(() => {
    queryClient.clear()
  }, [queryClient, userId])

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}
