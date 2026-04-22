'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

// Watches for a freshly-installed (waiting) service worker and surfaces an
// "Update available" prompt so the worker decides when to refresh — never
// while they're mid-photo or mid-signature. Production-only.
//
// The companion service worker (public/sw.js) intentionally does NOT
// self.skipWaiting() during install. We send SKIP_WAITING here, then reload
// once `controllerchange` fires.
export default function UpdateBanner() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    let cancelled = false
    // Snapshot whether a controller existed at registration time. The first
    // SW install also fires controllerchange (null → new SW) and we must
    // NOT reload then, only on subsequent updates.
    const hadControllerOnLoad = !!navigator.serviceWorker.controller
    let reloading = false

    const trackRegistration = (reg: ServiceWorkerRegistration) => {
      // SW already waiting from a previous load.
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)

      const onUpdateFound = () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          if (cancelled) return
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing)
          }
        })
      }
      reg.addEventListener('updatefound', onUpdateFound)
    }

    navigator.serviceWorker.getRegistration().then(reg => {
      if (cancelled || !reg) return
      trackRegistration(reg)
    })

    // Only reload on controller swap if we *had* a controller to begin with.
    // First install: controller goes null → SW; we don't want to reload.
    // Update accepted: existing SW → new SW; we DO want to reload.
    const onControllerChange = () => {
      if (!hadControllerOnLoad) return
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  if (!waiting) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-4 right-4 sm:left-auto sm:right-6 bottom-4 z-50 sm:max-w-sm bg-brand-navy text-white rounded-2xl shadow-2xl ring-1 ring-white/10 p-4 flex items-center gap-3"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <RefreshCw className="h-5 w-5 text-brand-yellow shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">Update available</p>
        <p className="text-xs text-white/70">A newer version of LOTO is ready.</p>
      </div>
      <button
        type="button"
        onClick={() => waiting.postMessage('SKIP_WAITING')}
        className="px-3 py-1.5 rounded-lg bg-brand-yellow text-brand-navy text-sm font-bold hover:bg-brand-yellow/90 transition-colors"
      >
        Refresh
      </button>
    </div>
  )
}
