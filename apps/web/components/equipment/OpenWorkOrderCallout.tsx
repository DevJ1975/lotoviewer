'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Surfaces a callout on the equipment detail when at least one CMMS
// work order is open against this equipment. The wording is taken
// straight from the §147(c)(6)/(c)(7) compliance line — confirming
// zero-energy verification before WO closeout is the contractor /
// host's responsibility.

interface Props {
  tenantId:    string | null
  equipmentId: string
}

interface OpenWoRow {
  id:                 string
  cmms_work_order_id: string
  cmms_system:        string
  status:             string
}

export default function OpenWorkOrderCallout({ tenantId, equipmentId }: Props) {
  const [rows, setRows] = useState<OpenWoRow[]>([])

  useEffect(() => {
    if (!tenantId) return
    let cancelled = false
    void supabase
      .from('cmms_work_order_links')
      .select('id, cmms_work_order_id, cmms_system, status')
      .eq('tenant_id', tenantId)
      .eq('equipment_id', equipmentId)
      .is('closed_at', null)
      .then(({ data }) => {
        if (cancelled) return
        setRows((data ?? []) as OpenWoRow[])
      })
    return () => { cancelled = true }
  }, [tenantId, equipmentId])

  if (rows.length === 0) return null

  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
            {rows.length === 1 ? '1 open work order' : `${rows.length} open work orders`} for this equipment
          </p>
          <p className="text-[11px] text-amber-900 dark:text-amber-100 mt-0.5">
            Confirm zero-energy verification before closeout. Record a periodic inspection once the
            LOTO procedure has been applied.
          </p>
          <ul className="mt-2 space-y-1">
            {rows.map(r => (
              <li key={r.id} className="text-xs text-amber-900 dark:text-amber-100 font-mono">
                {r.cmms_system.toUpperCase()} · WO #{r.cmms_work_order_id} · {r.status}
              </li>
            ))}
          </ul>
          <Link
            href={`/equipment/${encodeURIComponent(equipmentId)}/periodic-inspection`}
            className="inline-flex items-center gap-1 mt-2 text-xs font-semibold text-amber-900 dark:text-amber-100 hover:underline"
          >
            Record periodic inspection <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </section>
  )
}
