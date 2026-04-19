'use client'

import { useState, useEffect } from 'react'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const PING_INTERVAL = 30_000  // 30 seconds
const PING_TIMEOUT  = 5_000   // 5 seconds

async function pingSupabase(): Promise<boolean> {
  if (!SUPABASE_URL) return true  // If misconfigured, assume online
  try {
    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), PING_TIMEOUT)
    await fetch(SUPABASE_URL, {
      method: 'HEAD',
      mode:   'no-cors',    // Don't fail on CORS; we only care about reachability
      cache:  'no-store',
      signal: controller.signal,
    })
    clearTimeout(t)
    return true
  } catch {
    return false
  }
}

export function useNetworkStatus() {
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function check() {
      const reachable = await pingSupabase()
      if (!cancelled) setOnline(reachable)
    }

    // Initial check
    check()

    // Periodic poll
    const interval = setInterval(check, PING_INTERVAL)

    // React to browser-level events as immediate triggers for a re-check
    const onTrigger = () => check()
    window.addEventListener('online',  onTrigger)
    window.addEventListener('offline', onTrigger)

    return () => {
      cancelled = true
      clearInterval(interval)
      window.removeEventListener('online',  onTrigger)
      window.removeEventListener('offline', onTrigger)
    }
  }, [])

  return { online }
}
