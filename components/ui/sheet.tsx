'use client'

import { useEffect, useRef } from 'react'

interface Props {
  open:     boolean
  onClose:  () => void
  title:    string
  subtitle?: string
  children: React.ReactNode
  widthClass?: string
}

// Reference counter for body scroll lock so nested/overlapping sheets don't
// release the lock while another sheet is still open.
let scrollLockCount = 0
function acquireScrollLock() {
  if (scrollLockCount === 0) document.body.style.overflow = 'hidden'
  scrollLockCount++
}
function releaseScrollLock() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = ''
}

export function Sheet({ open, onClose, title, subtitle, children, widthClass = 'max-w-2xl' }: Props) {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onCloseRef.current() }
    document.addEventListener('keydown', onKey)
    acquireScrollLock()
    return () => {
      document.removeEventListener('keydown', onKey)
      releaseScrollLock()
    }
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div className={`relative bg-white dark:bg-slate-900 w-full ${widthClass} h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200`}>
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {subtitle && <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 text-xl leading-none transition-colors"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
