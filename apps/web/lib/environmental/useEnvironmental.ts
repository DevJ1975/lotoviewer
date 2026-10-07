'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { useFacility } from '@/components/FacilityProvider'
import { useTenant } from '@/components/TenantProvider'
import { errorMessage, getSite, type Scope, type SiteDetail } from './client'

// What every environmental screen needs from its surroundings: who is asking, for
// which tenant and site, and whether they may change things.

export function useEnvironmentalScope(): {
  scope: Scope | null
  facilityId: string | null
  facilityName: string | null
  canAdmin: boolean
  ready: boolean
} {
  const { tenant, role } = useTenant()
  const { profile } = useAuth()
  const { facilityId, facility, loading } = useFacility()

  const tenantId = tenant?.id ?? null
  const scope = useMemo<Scope | null>(() => (tenantId ? { tenantId, facilityId } : null), [tenantId, facilityId])
  const canAdmin = role === 'owner' || role === 'admin' || !!profile?.is_superadmin

  return { scope, facilityId, facilityName: facility?.name ?? null, canAdmin, ready: !!tenantId && !loading }
}

/** The active site's environmental profile and library status; null in the all-sites roll-up. */
export function useEnvironmentalSite() {
  const { scope, facilityId, ready } = useEnvironmentalScope()
  const [site, setSite] = useState<SiteDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!scope || !facilityId) { setSite(null); return }
    setLoading(true); setError(null)
    try { setSite(await getSite(scope, facilityId)) }
    catch (e) { setError(errorMessage(e, 'Could not load this site.')) }
    finally { setLoading(false) }
  }, [scope, facilityId])

  useEffect(() => { if (ready) void reload() }, [ready, reload])

  return { site, loading, error, reload, setSite }
}
