'use client'

import { useEffect, useState } from 'react'
import { HardDrive } from 'lucide-react'

const POLL_MS = 5 * 60_000   // recheck every 5 minutes
const WARN_AT = 0.8          // 80% of quota

// iPadOS quietly evicts cached PWA storage when it gets full — and an iPad
// shared by a crew can fill up fast. This banner appears when usage crosses
// 80% so admins know to clear something out (or to bug us about it). Polls
// quietly in the background; renders nothing on browsers without the
// Storage estimate API (older iOS, etc).
export default function StorageQuotaBanner() {
  const [usagePct, setUsagePct] = useState<number | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (typeof navigator === 'undefined') return
    const storage = navigator.storage
    if (!storage || typeof storage.estimate !== 'function') return

    let cancelled = false
    const check = async () => {
      try {
        const est = await storage.estimate()
        if (cancelled) return
        if (typeof est.quota !== 'number' || typeof est.usage !== 'number' || est.quota === 0) {
          setUsagePct(null)
          return
        }
        setUsagePct(est.usage / est.quota)
      } catch {
        setUsagePct(null)
      }
    }
    check()
    const interval = setInterval(check, POLL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (dismissed) return null
  if (usagePct === null || usagePct < WARN_AT) return null

  const pct = Math.round(usagePct * 100)
  const critical = usagePct >= 0.95
  const tone = critical
    ? 'bg-rose-600 text-white'
    : 'bg-amber-500 text-amber-950'

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold ${tone}`}
    >
      <HardDrive className="h-4 w-4" />
      <span>Storage {pct}% full{critical ? ' — uploads may fail' : ''}.</span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="opacity-70 hover:opacity-100 underline text-xs"
      >
        Dismiss
      </button>
    </div>
  )
}
