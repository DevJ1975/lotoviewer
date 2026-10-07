'use client'

import { useEffect, useState } from 'react'
import { evidenceUrl } from './evidence'

/**
 * A time-limited link to a stored file, or null while it is being signed or when it
 * cannot be (deleted, not yours, or null in). The stored path is private: it is not
 * something a person can open, so it is signed on demand and expires.
 */
export function useEvidenceUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    setUrl(null)
    if (path) void evidenceUrl(path).then(signed => { if (!cancelled) setUrl(signed) })
    return () => { cancelled = true }
  }, [path])
  return url
}
