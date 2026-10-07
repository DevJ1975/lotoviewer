'use client'

import { useId, type ReactNode } from 'react'

// A labelled slot for a control that is more than one native input (the owner
// picker, the evidence upload). `Field` wraps its children in a <label>, which
// would make a click on the caption press the first button inside them, such as
// "Clear owner".
export function FieldGroup({ label, children }: { label: string; children: ReactNode }) {
  const labelId = useId()
  return (
    <div role="group" aria-labelledby={labelId} className="space-y-1">
      <span id={labelId} className="block text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
    </div>
  )
}
