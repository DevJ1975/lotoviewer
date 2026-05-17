'use client'

import { useEffect, useState } from 'react'
import { loadRecents, RECENTS_EVENT } from '@/lib/recentRoutes'

// Reactive view over the per-tenant recents list. Listens to the
// `soteria:recents-updated` window event dispatched by pushRecent so
// every mounted consumer (drawer + any future recents panel) stays in
// sync without prop-drilling.

export function useRecentRoutes(tenantId: string | null | undefined): string[] {
  const [hrefs, setHrefs] = useState<string[]>([])

  useEffect(() => {
    if (!tenantId) {
      setHrefs([])
      return
    }
    setHrefs(loadRecents(tenantId))

    function onUpdate() { setHrefs(loadRecents(tenantId!)) }
    window.addEventListener(RECENTS_EVENT, onUpdate)

    // Cross-tab sync: another tab mutating the same tenant's recents
    // emits a storage event in this tab. We re-read whenever our key
    // changes; ignore other keys.
    function onStorage(e: StorageEvent) {
      if (!e.key) return
      if (!e.key.endsWith(tenantId!)) return
      setHrefs(loadRecents(tenantId!))
    }
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(RECENTS_EVENT, onUpdate)
      window.removeEventListener('storage', onStorage)
    }
  }, [tenantId])

  return hrefs
}
