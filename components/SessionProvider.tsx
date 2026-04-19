'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const RECENT_KEY = 'loto:recent'
const FLAGS_KEY  = 'loto:flags'
const MAX_RECENT = 10

interface SessionContextValue {
  recents:     string[]
  flags:       Set<string>
  recordVisit: (equipmentId: string) => void
  toggleFlag:  (equipmentId: string) => void
  isFlagged:   (equipmentId: string) => boolean
  clearFlags:  () => void
}

const DEFAULTS: SessionContextValue = {
  recents:     [],
  flags:       new Set(),
  recordVisit: () => {},
  toggleFlag:  () => {},
  isFlagged:   () => false,
  clearFlags:  () => {},
}

const Ctx = createContext<SessionContextValue>(DEFAULTS)

export function useSession(): SessionContextValue {
  return useContext(Ctx)
}

function readSession<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeSession<T>(key: string, value: T): void {
  if (typeof window === 'undefined') return
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode */ }
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [recents, setRecents] = useState<string[]>([])
  const [flags, setFlags]     = useState<Set<string>>(new Set())

  // Hydrate from sessionStorage on mount (client-only)
  useEffect(() => {
    setRecents(readSession<string[]>(RECENT_KEY, []))
    setFlags(new Set(readSession<string[]>(FLAGS_KEY, [])))
  }, [])

  const recordVisit = useCallback((equipmentId: string) => {
    if (!equipmentId) return
    setRecents(prev => {
      const next = [equipmentId, ...prev.filter(id => id !== equipmentId)].slice(0, MAX_RECENT)
      writeSession(RECENT_KEY, next)
      return next
    })
  }, [])

  const toggleFlag = useCallback((equipmentId: string) => {
    if (!equipmentId) return
    setFlags(prev => {
      const next = new Set(prev)
      if (next.has(equipmentId)) next.delete(equipmentId)
      else next.add(equipmentId)
      writeSession(FLAGS_KEY, [...next])
      return next
    })
  }, [])

  const clearFlags = useCallback(() => {
    setFlags(new Set())
    writeSession(FLAGS_KEY, [])
  }, [])

  const isFlagged = useCallback((equipmentId: string) => flags.has(equipmentId), [flags])

  return (
    <Ctx.Provider value={{ recents, flags, recordVisit, toggleFlag, isFlagged, clearFlags }}>
      {children}
    </Ctx.Provider>
  )
}
