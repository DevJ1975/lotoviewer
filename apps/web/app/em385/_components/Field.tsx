// Shared form field for the EM-385 pages. The control is nested INSIDE the
// <label> for an implicit label↔control association — screen readers announce
// the field name without any id/htmlFor plumbing. Kept in one place so the
// create-project form and the item-detail editor stay visually identical.
import type { ReactNode } from 'react'

export const inputCls =
  'w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm'

export function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
        {required && <span className="text-rose-600 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  )
}
