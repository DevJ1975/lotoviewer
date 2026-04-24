'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Drafts older than this are discarded on restore. 24h covers "I got
// interrupted and came back the next morning" without keeping months-
// old stale forms around.
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000

interface Wrapper<T> { v: 1; t: number; d: T }

// sessionStorage-backed draft persistence for modal/sheet forms.
// Scoped to sessionStorage (not localStorage) on purpose:
//   - Tab-local, so two admins on a shared iPad can't see each other's
//     in-progress drafts.
//   - Cleared on tab close, so "abandoned" drafts don't haunt the user
//     forever.
//
// Usage (typical modal form):
//   const DEFAULT: State = { name: '', notes: '' }
//   const [state, setState, clearDraft, wasRestored] =
//     useFormDraft<State>('loto:addEquipment', DEFAULT)
//
//   <input value={state.name}
//          onChange={e => setState(s => ({ ...s, name: e.target.value }))} />
//   <button onClick={async () => { await save(state); clearDraft() }}>Save</button>
//
// Return tuple matches useState's feel: [state, setState, clear, wasRestored]
export function useFormDraft<T>(
  key: string,
  initial: T,
  opts: { maxAgeMs?: number } = {},
): [T, (updater: T | ((prev: T) => T)) => void, () => void, boolean] {
  const { maxAgeMs = DEFAULT_MAX_AGE_MS } = opts

  // Read the draft exactly once on first render — putting it inside the
  // useState initializer avoids a re-render-induced restore flash.
  const wasRestoredRef = useRef(false)
  const [state, setStateRaw] = useState<T>(() => {
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return initial
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return initial
      const parsed = JSON.parse(raw) as Wrapper<T>
      if (parsed?.v !== 1) return initial
      if (Date.now() - parsed.t > maxAgeMs) {
        sessionStorage.removeItem(key)
        return initial
      }
      wasRestoredRef.current = true
      return parsed.d
    } catch {
      return initial
    }
  })

  // Track the current `initial` reference so the save effect can detect
  // a clear() reset (which sets state back to initial) and skip writing.
  // Without this, clear() wiped storage, then the state update re-triggered
  // the save effect and the initial state got written right back.
  const initialRef = useRef(initial)
  initialRef.current = initial

  // Persist on every change. Quota/private-mode writes are ignored —
  // draft persistence is a best-effort UX nicety, not load-bearing.
  // Skips writing when state === initial (referential) so clear()'s
  // reset doesn't re-populate storage.
  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return
    if (state === initialRef.current) return
    try {
      const wrapper: Wrapper<T> = { v: 1, t: Date.now(), d: state }
      sessionStorage.setItem(key, JSON.stringify(wrapper))
    } catch { /* ignore */ }
  }, [key, state])

  const setState = useCallback((updater: T | ((prev: T) => T)) => {
    setStateRaw(updater)
  }, [])

  const clear = useCallback(() => {
    try { sessionStorage.removeItem(key) } catch { /* ignore */ }
    wasRestoredRef.current = false
    setStateRaw(initial)
    // Caller can choose to close the dialog after this — resetting to
    // `initial` here means a follow-up "Reopen the dialog without a
    // draft to restore" shows a clean form.
  }, [key, initial])

  return [state, setState, clear, wasRestoredRef.current]
}
