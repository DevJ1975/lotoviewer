'use client'

import { useState } from 'react'
import { ScanLine, AlertCircle } from 'lucide-react'
import EquipmentScanner, { type ScanResult } from '@/components/EquipmentScanner'
import HazardReportView from '@/components/HazardReport'
import { useAuth } from '@/components/AuthProvider'

// /scan — full-page scanner. Three states:
//   1. Camera + scanner UI (initial)
//   2. Multiple candidates from a photo scan → pick one
//   3. Hazard report for the chosen equipment

export default function ScanPage() {
  const { profile, loading } = useAuth()
  const [result, setResult] = useState<ScanResult | null>(null)
  const [chosenId, setChosenId] = useState<string | null>(null)

  if (loading) return <div className="p-8 text-slate-500 text-sm">Loading…</div>
  if (!profile) return <div className="p-8 text-slate-500 text-sm">Sign in to use the scanner.</div>

  // Decide which view to show.
  const stage = (() => {
    if (chosenId) return 'report' as const
    if (result?.candidates && result.candidates.length > 1) return 'candidates' as const
    if (result && (result.equipment_id || result.candidates?.length === 1)) return 'report-from-result' as const
    return 'scanner' as const
  })()

  const reportEquipmentId =
    chosenId ?? result?.equipment_id ?? (result?.candidates?.length === 1 ? result.candidates[0].equipment_id : null)

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
      <header className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center">
          <ScanLine className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Scan equipment</h1>
          <p className="text-xs text-slate-500">QR or photo. Resolves to the placard, then loads the AI hazard report.</p>
        </div>
      </header>

      {stage === 'scanner' && (
        <EquipmentScanner onResult={r => setResult(r)} />
      )}

      {stage === 'candidates' && result && (
        <div className="space-y-3">
          <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/30 p-3 flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-200">
              <p className="font-semibold">{result.candidates!.length} possible matches</p>
              <p>Pick the right one to load its hazard report.</p>
              {result.extraction?.notes && <p className="mt-1 text-amber-700 dark:text-amber-300">{result.extraction.notes}</p>}
            </div>
          </div>
          <ul className="rounded-md border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
            {result.candidates!.map(c => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setChosenId(c.equipment_id)}
                  className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                >
                  <div className="text-sm font-medium">{c.equipment_id}</div>
                  {c.description && <div className="text-xs text-slate-500">{c.description}</div>}
                  {c.department && <div className="text-[11px] text-slate-400">{c.department}</div>}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => { setResult(null); setChosenId(null) }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Scan again
          </button>
        </div>
      )}

      {(stage === 'report' || stage === 'report-from-result') && reportEquipmentId && (
        <div className="space-y-3">
          <HazardReportView equipmentId={reportEquipmentId} />
          <button
            type="button"
            onClick={() => { setResult(null); setChosenId(null) }}
            className="text-xs text-slate-500 hover:text-slate-700"
          >
            Scan another
          </button>
        </div>
      )}
    </div>
  )
}
