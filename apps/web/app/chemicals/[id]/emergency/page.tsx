'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { EmergencyView, type EmergencyProduct } from '@/app/chemicals/_components/EmergencyView'

// Chemical-scoped emergency view. A label QR that encodes the chemical detail
// URL resolves here (not to a specific container) when the scanner is in
// Emergency mode — see /chemicals/scan. All emergency content is product-level,
// so this reuses the same EmergencyView as the container view.
interface EmergencyProductRow extends EmergencyProduct {
  id: string
}

export default function ChemicalProductEmergencyPage() {
  const params = useParams<{ id: string }>()
  const id     = params?.id
  const { tenant } = useTenant()

  const [product, setProduct] = useState<EmergencyProductRow | null>(null)
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

      const res  = await fetch(`/api/chemicals/products/${id}`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        setProduct(null)
        return
      }
      setProduct(body.product)
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 flex items-center gap-2 text-slate-500">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
      </div>
    )
  }
  if (error || !product) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <Link href="/chemicals/scan" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to scan
        </Link>
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error ?? 'Chemical not found.'}
        </div>
      </div>
    )
  }

  return (
    <EmergencyView
      product={product}
      footer={
        <div className="flex justify-end pt-1 text-sm">
          <Link href={`/chemicals/${product.id}`} className="text-indigo-600 hover:underline">
            Full chemical details →
          </Link>
        </div>
      }
    />
  )
}
