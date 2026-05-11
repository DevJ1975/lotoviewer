'use client'

import { useRouter } from 'next/navigation'
import { QrCode } from 'lucide-react'
import EquipmentScanner, { type ScanResult } from '@/components/EquipmentScanner'

export default function EquipmentReadinessScanPage() {
  const router = useRouter()

  function handleResult(result: ScanResult) {
    const equipmentId = result.equipment_id || result.candidates?.[0]?.equipment_id
    if (!equipmentId) return
    router.push(`/equipment-readiness/inspect/${encodeURIComponent(equipmentId)}`)
  }

  return (
    <main className="max-w-2xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-700 text-white">
          <QrCode className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-slate-950 dark:text-slate-50">Scan & Inspect</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Scan the equipment QR or enter the asset ID to start a pre-use check.</p>
        </div>
      </header>
      <EquipmentScanner onResult={handleResult} />
    </main>
  )
}
