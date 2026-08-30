import { useEffect, useState } from 'react'

// Wall-clock time as render-safe state.
//
// Reading `Date.now()` during render is impure: nothing tells React the value
// went stale, so time-derived UI (an expiry that just lapsed, a bump test that
// just aged out) keeps showing whatever was true at the last unrelated render.
// Sampling on an interval makes the passage of time an explicit input.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])

  return now
}
