'use client'

import { useEffect } from 'react'
import type { ToastState } from '@/hooks/useToast'

interface Props extends ToastState {
  onClose: () => void
}

export default function Toast({ message, type, onClose }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3500)
    return () => clearTimeout(timer)
  }, [onClose])

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 duration-200 ${
        type === 'success' ? 'bg-emerald-500 text-white' : 'bg-rose-500 text-white'
      }`}
    >
      <span className="text-base leading-none">{type === 'success' ? '✓' : '✗'}</span>
      <span>{message}</span>
      <button
        onClick={onClose}
        className="ml-1 text-white/70 hover:text-white leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  )
}
