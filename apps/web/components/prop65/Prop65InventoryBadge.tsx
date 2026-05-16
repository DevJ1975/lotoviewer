'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Small inline badge for /chemicals/inventory/[id] pages — surfaces
// whether the row is linked to one or more Prop 65 entries and, if so,
// deep-links into the admin assessment form. Read-only; mounting the
// badge does NOT affect the rest of the chemicals module.

interface BadgeRow {
  confidence:    'auto' | 'confirmed'
  chemical_name: string
}

export function Prop65InventoryBadge(props: { tenantId: string | null; inventoryItemId: string | null }) {
  const { tenantId, inventoryItemId } = props
  const [rows, setRows] = useState<BadgeRow[] | null>(null)

  useEffect(() => {
    if (!tenantId || !inventoryItemId) return
    let cancelled = false
    void (async () => {
      const { data } = await supabase
        .from('prop65_chemical_links')
        .select('confidence, prop65_chemicals(chemical_name)')
        .eq('tenant_id', tenantId)
        .eq('chemical_inventory_id', inventoryItemId)
      if (cancelled) return
      type Raw = { confidence: 'auto' | 'confirmed'; prop65_chemicals: { chemical_name: string } | { chemical_name: string }[] | null }
      const flat: BadgeRow[] = []
      for (const r of (data ?? []) as unknown as Raw[]) {
        const v = r.prop65_chemicals
        const name = Array.isArray(v) ? v[0]?.chemical_name : v?.chemical_name
        if (name) flat.push({ confidence: r.confidence, chemical_name: name })
      }
      setRows(flat)
    })()
    return () => { cancelled = true }
  }, [tenantId, inventoryItemId])

  if (!rows || rows.length === 0) return null

  const allConfirmed = rows.every(r => r.confidence === 'confirmed')

  return (
    <div className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-[11px] ${
      allConfirmed ? 'border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-200'
                   : 'border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300'}`}>
      <ShieldAlert className="h-3.5 w-3.5" />
      <span>Prop 65: {rows.map(r => r.chemical_name).join(', ')}{allConfirmed ? '' : ' (auto)'}</span>
      {inventoryItemId && (
        <Link href={`/admin/prop65/assessments/new?chemicalId=${inventoryItemId}`} className="underline">
          assess →
        </Link>
      )}
    </div>
  )
}
