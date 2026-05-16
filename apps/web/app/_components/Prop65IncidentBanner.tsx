'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { findMatchingSafeHarbor } from '@soteria/core/prop65SafeHarbor'

// Light-touch Prop 65 callout on /incidents/[id]. When any of the
// incident's exposure events references a chemical product whose CAS
// number(s) hit the OEHHA list, surface a banner with a CTA to the
// admin assessment form. The banner does NOT mutate or refactor the
// incident module — it queries chemical_exposure_events and
// chemical_products independently.

interface ExposureRow {
  product_id: string
}
interface ProductRow {
  id:          string
  cas_numbers: string[] | null
}

export function Prop65IncidentBanner(props: { tenantId: string | null; incidentId: string }) {
  const { tenantId, incidentId } = props
  const [hit, setHit] = useState<{ chemical_name: string }[] | null>(null)

  useEffect(() => {
    if (!tenantId || !incidentId) return
    let cancelled = false
    void (async () => {
      const { data: events } = await supabase
        .from('chemical_exposure_events')
        .select('product_id')
        .eq('incident_id', incidentId)
        .eq('tenant_id', tenantId)
      const productIds = Array.from(new Set(((events ?? []) as ExposureRow[]).map(e => e.product_id).filter(Boolean)))
      if (productIds.length === 0) { if (!cancelled) setHit([]); return }
      const { data: products } = await supabase
        .from('chemical_products')
        .select('id, cas_numbers')
        .in('id', productIds)
        .eq('tenant_id', tenantId)
      const cas = ((products ?? []) as ProductRow[]).flatMap(p => p.cas_numbers ?? [])
      const matches = findMatchingSafeHarbor(cas)
      if (cancelled) return
      setHit(matches.map(m => ({ chemical_name: m.chemical_name })))
    })()
    return () => { cancelled = true }
  }, [tenantId, incidentId])

  if (!hit || hit.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 px-4 py-3 flex flex-wrap items-start gap-3">
      <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-300 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">Proposition 65 follow-up may be required</p>
        <p className="text-xs text-amber-900 dark:text-amber-200 mt-0.5">
          Exposure events on this incident involve OEHHA-listed substances: {hit.map(h => h.chemical_name).join(', ')}.
        </p>
      </div>
      <Link href="/admin/prop65/assessments/new" className="text-xs font-medium text-amber-900 dark:text-amber-100 underline whitespace-nowrap">
        Open assessment →
      </Link>
    </div>
  )
}
