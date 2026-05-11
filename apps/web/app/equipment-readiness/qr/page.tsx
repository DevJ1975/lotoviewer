'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import QRCode from 'qrcode'
import { Download, QrCode } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { EQUIPMENT_FAMILY_LABEL, type EquipmentFamily } from '@soteria/core/equipmentReadiness'

interface EquipmentRow {
  id: string
  equipment_id: string
  description: string | null
  department: string | null
  equipment_family: EquipmentFamily | null
  qr_token: string | null
}

interface LabelRow extends EquipmentRow {
  qrDataUrl: string
  url: string
}

export default function EquipmentQrLabelsPage() {
  const { tenant } = useTenant()
  const tenantId = tenant?.id ?? null
  const [rows, setRows] = useState<LabelRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error } = await supabase
      .from('loto_equipment')
      .select('id,equipment_id,description,department,equipment_family,qr_token')
      .eq('tenant_id', tenantId)
      .eq('decommissioned', false)
      .order('equipment_id', { ascending: true })
      .limit(100)
    if (error) {
      setError(error.message)
      return
    }
    const origin = window.location.origin
    const next: LabelRow[] = []
    for (const row of (data ?? []) as EquipmentRow[]) {
      const url = row.qr_token
        ? `${origin}/equipment-readiness/inspect/${encodeURIComponent(row.equipment_id)}?token=${row.qr_token}`
        : `${origin}/equipment-readiness/inspect/${encodeURIComponent(row.equipment_id)}`
      next.push({ ...row, url, qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 160 }) })
    }
    setRows(next)
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  function printLabels() {
    window.print()
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">Equipment Readiness QR Labels</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Print labels workers can scan to launch pre-use inspections.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/equipment-readiness" className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200">Back</Link>
          <button onClick={printLabels} className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-3 py-2 text-sm font-semibold text-white hover:bg-teal-800">
            <Download className="h-4 w-4" /> Print labels
          </button>
        </div>
      </header>

      {error && <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 print:hidden">{error}</div>}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 print:grid-cols-2">
        {rows.map(row => (
          <article key={row.id} className="break-inside-avoid rounded-lg border-2 border-slate-900 bg-white p-4 text-slate-950">
            <div className="flex items-start gap-4">
              <Image src={row.qrDataUrl} alt={`QR for ${row.equipment_id}`} width={128} height={128} unoptimized className="h-32 w-32" />
              <div className="min-w-0">
                <QrCode className="mb-2 h-5 w-5" />
                <p className="font-mono text-xl font-black">{row.equipment_id}</p>
                <p className="mt-1 text-sm font-semibold">Pre-use inspection</p>
                <p className="mt-2 text-xs">{row.description ?? 'Equipment'}</p>
                <p className="text-xs">{row.department ?? 'No department'}</p>
                {row.equipment_family && <p className="mt-2 text-[11px] font-semibold">{EQUIPMENT_FAMILY_LABEL[row.equipment_family]}</p>}
              </div>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
