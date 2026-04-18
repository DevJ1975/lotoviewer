'use client'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'

export default function OfflineBanner() {
  const { online } = useNetworkStatus()

  if (online) return null

  return (
    <div
      role="alert"
      className="sticky top-14 z-40 w-full bg-amber-400 text-amber-900 text-sm font-semibold flex items-center justify-center gap-2 py-2 px-4 shadow-sm"
    >
      <span>⚠</span>
      <span>You are offline — changes will not be saved until connectivity is restored.</span>
    </div>
  )
}
