'use client'

import { Download } from 'lucide-react'
import type { Equipment } from '@soteria/core/types'
import { downloadEquipmentCsv } from '@/lib/export'

interface Props {
  equipment:      Equipment[]
  decommissioned: ReadonlySet<string>
}

export default function ExportCsvButton({ equipment, decommissioned }: Props) {
  return (
    <button
      type="button"
      onClick={() => downloadEquipmentCsv(equipment, decommissioned)}
      title="Export Equipment CSV"
      aria-label="Export Equipment CSV"
      className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md h-11 w-11 flex items-center justify-center transition-colors"
    >
      <Download className="h-5 w-5" />
    </button>
  )
}
