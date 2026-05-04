'use client'

import { useEffect, useRef, useState } from 'react'
import { Undo2, Loader2 } from 'lucide-react'

// Generic undo banner for deferred-destroy actions. The PARENT owns the
// real API call — this component only manages the countdown + the
// "click Undo" path. When the timer expires we invoke `onCommit`; if
// the user clicks Undo we invoke `onUndo` and dismiss.
//
// ── React patterns demonstrated here (this file is a great study) ──────────
//
// REF vs STATE — when to use which:
//   useState  → drives RE-RENDER. Use when the JSX needs to react to
//               a value change.
//   useRef    → does NOT drive re-render. Use for non-render data:
//               timer handles, "did this fire yet" flags, latest-value
//               snapshots that callbacks need to see without going
//               through closures.
//
//   COMMON BUG: setting a ref's `.current` will NOT trigger a re-
//   render. If your JSX needs to change, you need state.
//
//   COMMON BUG: reading state inside a long-lived closure (setTimeout
//   callback, useEffect cleanup) gives you the value AT CLOSURE TIME,
//   not the latest. Refs solve this — the `.current` is shared.
//
//   This file uses BOTH for the `dismissed` signal:
//     - `dismissed` STATE drives the JSX hide (return null)
//     - `dismissedRef` MIRRORS state for the timer + cleanup so they
//       see the latest value without restarting on every render.
//
// USEEFFECT cleanup pattern:
//   The function you return from useEffect runs when the effect
//   re-runs (deps changed) OR when the component unmounts. We use it
//   here to:
//     a) clear the setTimeout/setInterval handles (so timers don't
//        fire after unmount and call setState on a dead component)
//     b) commit defensively on unmount (the "user navigated away
//        before clicking Undo" case)
//
// Pattern in MembersSection:
//   1. User clicks Remove → row hidden optimistically + pending
//      action queued (NO API call yet)
//   2. UndoToast shows "Removed Bob — Undo (30s)"
//   3. After 30s the toast fires `onCommit` which calls the API
//   4. If the user clicks Undo, the row un-hides (no API call ever)

interface Props {
  message: string
  // Seconds the user has to click Undo. Defaults to 30.
  duration?: number
  onCommit: () => void | Promise<void>
  onUndo:   () => void
}

export function UndoToast({ message, duration = 30, onCommit, onUndo }: Props) {
  // Two related signals:
  //   `dismissed` STATE     — drives the re-render that hides the toast
  //                           after Undo is clicked. JSX uses it directly.
  //   `dismissedRef` REF    — mirrors `dismissed` so non-render code
  //                           (timer callbacks + the unmount cleanup)
  //                           can check the LATEST value without going
  //                           through stale closures.
  //   `committedRef` REF    — single-fire guard. The timer commit and
  //                           the unmount-defensive commit can both
  //                           fire; this prevents both running.
  const [secondsLeft, setSecondsLeft] = useState(duration)
  const [committing, setCommitting]   = useState(false)
  const [dismissed, setDismissed]     = useState(false)
  const dismissedRef = useRef(false)
  const committedRef = useRef(false)

  // Keep the ref in sync with the state on every render.
  useEffect(() => { dismissedRef.current = dismissed }, [dismissed])

  // Single timer for the actual commit (vs. a counter timer for the
  // display below). Splitting them keeps the commit deterministic in
  // tests — advance fake timers by `duration*1000` and the commit
  // fires exactly once.
  useEffect(() => {
    if (dismissedRef.current) return
    const handle = setTimeout(() => {
      if (dismissedRef.current || committedRef.current) return
      committedRef.current = true
      setCommitting(true)
      void Promise.resolve(onCommit()).finally(() => setCommitting(false))
    }, duration * 1000)
    return () => clearTimeout(handle)
  }, [duration, onCommit])

  // Display-only countdown — separate from the commit timer so a slow
  // tick interval can't delay the destructive action.
  useEffect(() => {
    if (dismissedRef.current) return
    const tick = setInterval(() => {
      setSecondsLeft(s => (s > 0 ? s - 1 : 0))
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  // Defensive commit on unmount: the user navigated away without
  // clicking Undo and before the timer fired. Preserves intent.
  useEffect(() => {
    return () => {
      if (!dismissedRef.current && !committedRef.current) {
        committedRef.current = true
        void onCommit()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (dismissed) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full shadow-2xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 max-w-[min(92vw,500px)]"
    >
      {committing
        ? <Loader2 className="h-4 w-4 animate-spin shrink-0" />
        : <span className="text-xs font-mono tabular-nums opacity-80 shrink-0">{secondsLeft}s</span>}
      <span className="text-sm flex-1 min-w-0 truncate">{message}</span>
      <button
        type="button"
        onClick={() => {
          dismissedRef.current = true  // immediate guard for in-flight timers
          setDismissed(true)            // triggers re-render so JSX returns null
          onUndo()
        }}
        disabled={committing}
        className="inline-flex items-center gap-1 text-xs font-bold uppercase tracking-wider px-2 py-1 rounded bg-white/15 dark:bg-slate-900/15 hover:bg-white/25 dark:hover:bg-slate-900/25 transition-colors disabled:opacity-50"
      >
        <Undo2 className="h-3.5 w-3.5" />
        Undo
      </button>
    </div>
  )
}
