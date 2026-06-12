'use client'

import { useEffect, useState } from 'react'

// Ticking clock as a hook: returns a Date that advances every `intervalMs`.
// Each consumer owns its own interval so a live timer (a countdown, a
// "updated 23s ago" label) re-renders only the leaf that reads it — not the
// whole tree the leaf happens to sit in. That isolation is the point: the
// home dashboard used to thread one parent-level `now` through every panel,
// re-rendering the entire page once a second.
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
