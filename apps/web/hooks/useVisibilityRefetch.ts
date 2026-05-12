'use client'

import { useEffect, useRef } from 'react'

// iPads suspend backgrounded PWA tabs aggressively — when the user comes
// back (swipes the app from the switcher, unlocks the device, or pulls the
// home-screen icon after lunch), the realtime channel has likely missed
// events. A single refetch when the page becomes visible again is the
// cheapest way to guarantee the view is fresh without running a poll.
//
// Also fires on `window focus` because iOS occasionally delivers focus
// without a visibilitychange when returning from another app via the app
// switcher — relying on one alone misses cases.
//
// `onVisible` is stashed in a ref so the listeners bind exactly once per
// mount — when a parent recreates the callback (the common case), we
// don't churn through addEventListener/removeEventListener on every
// render. Same pattern as components/SignaturePad.tsx's `onChangeRef`.
export function useVisibilityRefetch(onVisible: () => void) {
  const onVisibleRef = useRef(onVisible)
  onVisibleRef.current = onVisible

  useEffect(() => {
    function handler() {
      if (document.visibilityState === 'visible') onVisibleRef.current()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])
}
