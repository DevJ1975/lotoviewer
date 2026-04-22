'use client'

import { useEffect, useRef, useState } from 'react'
import { Clock, LogOut } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { computeIdleState } from '@/lib/idle'

const IDLE_MS    = 30 * 60_000   // 30 min total inactivity
const WARNING_MS = 60_000        // last minute → show warning

// Activity events fire on `window`; visibilitychange must go on `document`.
const WINDOW_EVENTS  = ['pointerdown', 'keydown', 'scroll', 'touchstart'] as const
const DOC_EVENTS     = ['visibilitychange'] as const

// Auto-signs the user out after IDLE_MS of inactivity. Designed for shared
// field iPads that may be set down in a control room or break area. The
// last WARNING_MS shows a banner with a "Stay" button that resets the timer;
// any user activity does the same silently. Visibility return (iPad wake-up
// from sleep) also counts as activity.
export default function IdleLogout() {
  const { userId, signOut } = useAuth()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const lastActivityAt = useRef<number>(Date.now())

  const reset = () => {
    lastActivityAt.current = Date.now()
    setSecondsLeft(null)
  }

  useEffect(() => {
    if (!userId) {
      setSecondsLeft(null)
      return
    }

    lastActivityAt.current = Date.now()
    const onActivity = () => {
      lastActivityAt.current = Date.now()
      setSecondsLeft(null)  // React bails out cheaply if already null
    }
    for (const ev of WINDOW_EVENTS) window.addEventListener(ev, onActivity, { passive: true })
    for (const ev of DOC_EVENTS)    document.addEventListener(ev, onActivity)

    const interval = setInterval(() => {
      const state = computeIdleState(Date.now(), lastActivityAt.current, { idleMs: IDLE_MS, warningMs: WARNING_MS })
      if (state.kind === 'expired') {
        signOut()
      } else if (state.kind === 'warning') {
        setSecondsLeft(state.secondsLeft)
      }
    }, 1000)

    return () => {
      clearInterval(interval)
      for (const ev of WINDOW_EVENTS) window.removeEventListener(ev, onActivity)
      for (const ev of DOC_EVENTS)    document.removeEventListener(ev, onActivity)
    }
  // signOut/userId are the only inputs that should re-arm the timer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  if (secondsLeft === null) return null

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      className="fixed left-4 right-4 sm:left-auto sm:right-6 bottom-4 z-50 sm:max-w-sm bg-amber-500 text-amber-950 rounded-2xl shadow-2xl ring-1 ring-amber-700/20 p-4 flex items-center gap-3"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <Clock className="h-5 w-5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold">Signing out soon</p>
        <p className="text-xs">Idle. Auto-logout in {secondsLeft}s.</p>
      </div>
      <button
        type="button"
        onClick={reset}
        className="px-3 py-1.5 rounded-lg bg-amber-950 text-amber-50 text-sm font-bold hover:bg-amber-900 transition-colors"
      >
        Stay
      </button>
      <button
        type="button"
        onClick={() => signOut()}
        aria-label="Sign out now"
        title="Sign out now"
        className="text-amber-950/70 hover:text-amber-950 p-1 rounded"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  )
}
