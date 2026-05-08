'use client'

import { useCallback, useEffect, useRef } from 'react'

// Polls /api/chat/channels/[id]/messages?since=<lastSeen> while the
// channel pane is visible. Web Push is the out-of-tab story; this hook
// is the in-tab story.
//
// Behaviour:
//   - Active when document.visibilityState === 'visible' AND `enabled`
//   - Pauses immediately when the tab is hidden, resumes when visible
//   - Uses an interval, not setTimeout chains, so a slow request
//     doesn't push subsequent polls farther into the future
//   - Default cadence 4 seconds — fast enough to feel live, slow
//     enough that a 100-user tenant doesn't hammer the API

interface Options {
  intervalMs?: number
  enabled?:    boolean
}

export function useChannelPolling(poll: () => Promise<void> | void, opts: Options = {}) {
  const { intervalMs = 4000, enabled = true } = opts
  const handleRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollRef   = useRef(poll)

  // Keep the latest `poll` reachable from the interval handler without
  // resubscribing the interval on every parent render. Refs must NOT
  // be mutated during render — the assignment lives in an effect.
  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  // Wrap the user's poll fn in a guard so overlapping tabs / multiple
  // calls don't double-fire when the interval and a manual call race.
  const inFlightRef = useRef(false)
  const tick = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    try { await pollRef.current() }
    finally { inFlightRef.current = false }
  }, [])

  useEffect(() => {
    if (!enabled) return

    function start() {
      if (handleRef.current) return
      // Run once immediately so the user doesn't wait `intervalMs`
      // for the first refresh after toggling visible.
      void tick()
      handleRef.current = setInterval(() => { void tick() }, intervalMs)
    }
    function stop() {
      if (handleRef.current) {
        clearInterval(handleRef.current)
        handleRef.current = null
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [enabled, intervalMs, tick])
}
