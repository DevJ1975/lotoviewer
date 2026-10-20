import { useEffect, useState } from 'react'

// A clock that re-renders its caller every `intervalMs`, for live permit
// countdowns. Callers pass `now` into the pure core helpers so the display
// stays deterministic and testable.
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
