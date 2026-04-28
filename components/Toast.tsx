'use client'

import { useEffect, useRef } from 'react'
import type { ToastState } from '@/hooks/useToast'

interface Props extends ToastState {
  onClose: () => void
}

const STYLE = {
  success: 'bg-emerald-500 text-white',
  error:   'bg-rose-500 text-white',
  info:    'bg-slate-800 text-white',
} as const

const ICON = { success: '✓', error: '✗', info: 'ⓘ' } as const

// Auto-dismisses after 3.5s normally, 6s when an inline action is present
// so the user has time to read + click "Undo", and 9s for errors so the
// user can actually read what went wrong (3.5s is too short on a tablet
// when something fails — by the time you focus on the toast it's gone).
// Refs keep the timer stable across parent re-renders that hand us a
// fresh onClose closure.
export default function Toast({ message, type, action, onClose }: Props) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    const timeout = type === 'error' ? 9000 : action ? 6000 : 3500
    const timer = setTimeout(() => onCloseRef.current(), timeout)
    return () => clearTimeout(timer)
  }, [message, type, action])

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 left-6 sm:left-auto z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 duration-200 ${STYLE[type]}`}
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <span className="text-base leading-none">{ICON[type]}</span>
      <span className="flex-1">{message}</span>
      {action && (
        <button
          type="button"
          onClick={() => { action.onClick(); onClose() }}
          className="font-bold uppercase tracking-wider text-xs px-2 py-1 rounded-md bg-white/15 dark:bg-slate-900/15 hover:bg-white/25 dark:hover:bg-slate-900/25 transition-colors"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={onClose}
        className="text-white/70 hover:text-white leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
