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
  // `restored` rides along in the same state object rather than a ref:
  // callers render it, so React has to be told when it changes.
  const [draft, setDraft] = useState<{ value: T; restored: boolean }>(() => {
    const fresh = { value: initial, restored: false }
    if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return fresh
    try {
      const raw = sessionStorage.getItem(key)
      if (!raw) return fresh
      const parsed = JSON.parse(raw) as Wrapper<T>
      if (parsed?.v !== 1) return fresh
      if (Date.now() - parsed.t > maxAgeMs) {
        sessionStorage.removeItem(key)
        return fresh
      }
      return { value: parsed.d, restored: true }
    } catch {
      return fresh
    }
  })
  const state = draft.value

  // Track the current `initial` reference so the save effect can detect
  // a clear() reset (which sets state back to initial) and skip writing.
  // Without this, clear() wiped storage, then the state update re-triggered
  // the save effect and the initial state got written right back.
  const initialRef = useRef(initial)
  useEffect(() => { initialRef.current = initial }, [initial])

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
    setDraft(prev => ({
      value: typeof updater === 'function' ? (updater as (prev: T) => T)(prev.value) : updater,
      restored: prev.restored,
    }))
  }, [])

  const clear = useCallback(() => {
    try { sessionStorage.removeItem(key) } catch { /* ignore */ }
    setDraft({ value: initial, restored: false })
    // Caller can choose to close the dialog after this — resetting to
    // `initial` here means a follow-up "Reopen the dialog without a
    // draft to restore" shows a clean form.
  }, [key, initial])

  return [state, setState, clear, draft.restored]
}
