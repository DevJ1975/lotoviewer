'use client'

import { useEffect } from 'react'

// Registers the service worker once, in production only. Dev mode skips it
// because Next's HMR conflicts with SW caching of /_next/static/* files.
//
// Browsers that lack `serviceWorker` (older iOS in private mode, etc.)
// silently no-op. The component renders nothing.
export default function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') return

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(err => {
        // Don't crash the app for SW registration failures — they're
        // recoverable on the next page load.
        console.warn('[pwa] service worker registration failed', err)
      })
    }

    // Wait for the page to settle so the SW install doesn't compete with
    // first-paint resource fetches.
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }, [])

  return null
}
