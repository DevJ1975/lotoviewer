// Shared client-side helpers for the EM-385 module pages: building the
// authenticated fetch headers (bearer token + active tenant) and the status /
// category visual maps. Kept in one place so the list, detail, and item pages
// stay consistent.

import { supabase } from '@/lib/supabase'
import type { Em385Status } from '@soteria/core/em385'

// Build the headers every EM-385 API call needs. Returns null when there is no
// active tenant yet (caller should bail).
export async function em385Headers(tenantId: string | undefined): Promise<Record<string, string> | null> {
  if (!tenantId) return null
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = {
    'content-type':    'application/json',
    'x-active-tenant': tenantId,
  }
  if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
  return headers
}

// Tailwind pill classes per register-item status. Mirrors the muted/solid
// language used elsewhere in the app.
export const EM385_STATUS_PILL: Record<Em385Status, string> = {
  not_started:    'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  in_progress:    'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300',
  submitted:      'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  accepted:       'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  expired:        'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
  not_applicable: 'bg-slate-100 text-slate-400 line-through dark:bg-slate-800 dark:text-slate-500',
}
