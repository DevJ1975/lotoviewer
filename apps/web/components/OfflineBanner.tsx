'use client'

import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useUploadQueue } from '@/components/UploadQueueProvider'

export default function OfflineBanner() {
  const { online }       = useNetworkStatus()
  const { queueCount, syncing, syncNow, clearAll } = useUploadQueue()

  // Offline — highest priority
  if (!online) {
    return (
      <div
        role="alert"
        className="sticky top-14 z-40 w-full bg-rose-500 text-white text-sm font-semibold flex items-center justify-center gap-2 py-2 px-4 shadow-sm"
      >
        <span>⚠</span>
        <span>Offline — photos will queue until reconnected.</span>
        {queueCount > 0 && (
          <span className="bg-white/20 dark:bg-slate-900/20 rounded-full px-2 py-0.5 text-xs tabular-nums">{queueCount} queued</span>
        )}
      </div>
    )
  }

  // Syncing
  if (syncing) {
    return (
      <div
        role="status"
        className="sticky top-14 z-40 w-full bg-amber-400 text-amber-900 dark:text-amber-100 text-sm font-semibold flex items-center justify-center gap-2 py-2 px-4 shadow-sm"
      >
        <span className="w-3 h-3 border-2 border-amber-900/40 border-t-amber-900 rounded-full animate-spin" />
        <span>Syncing {queueCount} queued upload{queueCount === 1 ? '' : 's'}…</span>
      </div>
    )
  }

  // Queued (online, not syncing)
  if (queueCount > 0) {
    return (
      <div
        role="status"
        className="sticky top-14 z-40 w-full bg-amber-400 text-amber-900 dark:text-amber-100 text-sm font-semibold flex items-center justify-center gap-3 py-2 px-4 shadow-sm"
      >
        <span>☁︎</span>
        <span>{queueCount} upload{queueCount === 1 ? '' : 's'} queued.</span>
        <button
          type="button"
          onClick={() => syncNow()}
          className="bg-amber-900 text-amber-50 rounded-md px-2.5 py-0.5 text-xs hover:bg-amber-900/90 transition-colors"
        >
          Sync Now
        </button>
        <button
          type="button"
          onClick={() => { if (confirm('Clear all queued uploads? This cannot be undone.')) clearAll() }}
          className="text-amber-900 dark:text-amber-100 underline hover:no-underline text-xs"
        >
          Clear
        </button>
      </div>
    )
  }

  return null
}
