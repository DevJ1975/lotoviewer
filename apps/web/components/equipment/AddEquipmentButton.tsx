'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Equipment } from '@soteria/core/types'
import AddEquipmentDialog from './AddEquipmentDialog'

interface Props {
  equipment: Equipment[]
  onAdded:   (row: Equipment) => void
}

export default function AddEquipmentButton({ equipment, onAdded }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Add Equipment"
        aria-label="Add Equipment"
        className="text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md h-11 w-11 flex items-center justify-center transition-colors"
      >
        <Plus className="h-5 w-5" />
      </button>
      {open && (
        <AddEquipmentDialog
          equipment={equipment}
          onClose={() => setOpen(false)}
          onAdded={row => { onAdded(row); setOpen(false) }}
        />
      )}
    </>
  )
}
