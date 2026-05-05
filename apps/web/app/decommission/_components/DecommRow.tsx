'use client'

import { Check, Loader2 } from 'lucide-react'
import type { Equipment } from '@soteria/core/types'

interface DecommRowProps {
  eq:             Equipment
  pending:        boolean
  isSelected:     boolean
  onToggle:       () => void
  onSelectChange: (selected: boolean) => void
  onKeyDown:      (e: React.KeyboardEvent<HTMLDivElement>) => void
  registerRef:    (el: HTMLDivElement | null) => void
}

// One row in the decommission list. The whole row is the click target for
// flipping decommissioned (the parent owns the optimistic update + undo);
// the small checkbox at the start handles multi-select for bulk ops and
// stops propagation so it doesn't double-fire as a row toggle.

export function DecommRow({ eq, pending, isSelected, onToggle, onSelectChange, onKeyDown, registerRef }: DecommRowProps) {
  const checked = eq.decommissioned
  return (
    <div
      ref={registerRef}
      role="checkbox"
      aria-checked={checked}
      aria-disabled={pending}
      aria-label={`${eq.equipment_id} ${eq.description}`}
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      className={`flex items-center gap-3 px-3 sm:px-4 py-3.5 min-h-[56px] cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/30 focus-visible:ring-inset ${
        isSelected ? 'bg-brand-navy/5 hover:bg-brand-navy/10' : checked ? 'bg-amber-50/30 dark:bg-amber-950/40/30 hover:bg-amber-50/60 dark:hover:bg-amber-950/40/60' : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
      }`}
    >
      {/* Multi-select checkbox — clicking it does NOT toggle decommissioned */}
      <label
        onClick={e => e.stopPropagation()}
        className="shrink-0 flex items-center justify-center h-9 w-9 -my-2 -ml-2 cursor-pointer"
      >
        <input
          type="checkbox"
          checked={isSelected}
          onChange={e => onSelectChange(e.target.checked)}
          aria-label={`Select ${eq.equipment_id}`}
          className="h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy/30"
        />
      </label>
      <span
        aria-hidden="true"
        className={`shrink-0 h-5 w-5 rounded border flex items-center justify-center transition-colors ${
          checked
            ? 'bg-brand-navy border-brand-navy text-white'
            : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700'
        }`}
      >
        {checked && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className={`font-mono text-sm font-bold truncate ${checked ? 'line-through text-muted-foreground' : 'text-brand-navy'}`}>
          {eq.equipment_id}
        </div>
        <div className={`text-xs truncate ${checked ? 'line-through text-muted-foreground' : 'text-slate-500 dark:text-slate-400'}`}>
          {eq.description}
        </div>
      </div>
      {pending && (
        <Loader2 className="h-4 w-4 text-slate-400 dark:text-slate-500 animate-spin shrink-0" aria-label="Saving" />
      )}
    </div>
  )
}
