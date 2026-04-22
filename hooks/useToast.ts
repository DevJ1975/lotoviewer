import { useState, useCallback } from 'react'

export interface ToastAction {
  label:   string
  onClick: () => void
}

export interface ToastState {
  message: string
  type:    'success' | 'error' | 'info'
  // Optional inline action — used for "Undo" patterns. The action is removed
  // from the toast as soon as it's clicked so it can't fire twice.
  action?: ToastAction
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null)

  const showToast = useCallback(
    (message: string, type: 'success' | 'error' | 'info' = 'success', action?: ToastAction) => {
      setToast({ message, type, action })
    },
    [],
  )

  const clearToast = useCallback(() => setToast(null), [])

  return { toast, showToast, clearToast }
}
