import type { FieldError } from '@/lib/environmental/client'

// Shared look for the register forms, matching the existing EMS pages.

export const LABEL = 'block'
export const LABEL_TEXT = 'text-xs font-semibold text-slate-600 dark:text-slate-300'
export const INPUT = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900'
export const BUTTON_PRIMARY = 'rounded-md bg-brand-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-40'
export const BUTTON_SECONDARY = 'rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800'
export const FIELD_ERROR = 'mt-1 text-[11px] text-rose-700 dark:text-rose-300'

/** The API's message for one body field, if it sent one. */
export function errorFor(errors: readonly FieldError[], field: string): string | null {
  return errors.find(e => e.field === field)?.message ?? null
}
