'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { EmergencyView } from '@/app/chemicals/_components/EmergencyView'
import type {
  ParsedSdsFirstAid,
  ParsedSdsSpillCleanup,
} from '@soteria/core/chemicals'

interface EmergencyItem {
  id:      string
  barcode: string
  status:  string
  chemical_products: {
    id:                string
    name:              string
    manufacturer:      string | null
    ghs_signal_word:   string | null
    ghs_pictograms:    string[] | null
    hazard_statements: { code: string; text: string }[] | null
    ppe_required:      string[] | null
    first_aid:         ParsedSdsFirstAid | null
    spill_cleanup:     ParsedSdsSpillCleanup | null
    emergency_phone:   string | null
  } | null
  chemical_locations: { name: string; path: string | null } | null
}

export default function ChemicalEmergencyPage() {
  const params = useParams<{ id: string }>()
  const id     = params?.id
  const { tenant } = useTenant()

  const [item,    setItem]    = useState<EmergencyItem | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const res  = await fetch(`/api/chemicals/inventory/${id}/emergency`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setItem(null)
        return
      }
      setItem(body.item)
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  const product = item?.chemical_products ?? null

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !item || !product) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link href="/chemicals/scan" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to scan
        </Link>
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error ?? 'Container not found.'}
        </div>
      </div>
    )
  }

  return (
    <EmergencyView
      product={product}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-sm">
          <span className="font-mono text-slate-400">{item.barcode}</span>
          <Link href={`/chemicals/inventory/${item.id}`} className="text-indigo-600 hover:underline">
            Full container details →
          </Link>
        </div>
      }
    />
  )
}
