import { supabase } from '../supabaseClient'
import type { LotoDevice, LotoDeviceCheckout } from '../types'

// Centralised loto_devices + loto_device_checkouts queries. Same shape
// as lib/queries/equipment.ts — helpers throw on Supabase error so
// callers `try/catch` once.

function unwrap<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (!result.data) throw new Error(`${what}: no data`)
  return result.data
}

// All non-decommissioned devices ordered by label. Used by the admin
// inventory page and the worker checkout picker.
export async function loadAllDevices(): Promise<LotoDevice[]> {
  const result = await supabase
    .from('loto_devices')
    .select('*')
    .eq('decommissioned', false)
    .order('device_label', { ascending: true })
  return unwrap(result as { data: LotoDevice[] | null; error: { message: string } | null }, 'loadAllDevices')
}

// Open checkouts (returned_at IS NULL). Each is paired with its
// device + owner so the admin page can render rows without N+1
// follow-ups. Sorted by checked_out_at desc so the longest-running
// stale checkouts surface at the top.
export interface OpenCheckoutRow {
  checkout: LotoDeviceCheckout
  device:   LotoDevice
}

export async function loadOpenCheckouts(): Promise<OpenCheckoutRow[]> {
  const { data: rows, error } = await supabase
    .from('loto_device_checkouts')
    .select(`
      *,
      device:loto_devices(*)
    `)
    .is('returned_at', null)
    .order('checked_out_at', { ascending: false })
  if (error) throw new Error(`loadOpenCheckouts: ${error.message}`)
  // The Supabase nested-select returns the device under a `device` key.
  // Cast through unknown because the supabase-js generic typing for
  // implicit joins isn't precise.
  return (rows ?? []).map(r => {
    const { device, ...checkout } = r as unknown as LotoDeviceCheckout & { device: LotoDevice }
    return { checkout: checkout as LotoDeviceCheckout, device }
  })
}

// Stale-checkout floor — anything held for more than this many hours
// is shown in the "needs attention" section of the admin page. 12h
// covers a long shift comfortably; anything beyond that is suspicious.
export const STALE_CHECKOUT_HOURS = 12

export function isStaleCheckout(checkout: { checked_out_at: string }, nowMs: number): boolean {
  const heldMs = nowMs - new Date(checkout.checked_out_at).getTime()
  return heldMs > STALE_CHECKOUT_HOURS * 60 * 60 * 1000
}

// Load a device by its label, used by the worker checkout picker
// when scanning a label or typing it. Returns null when the label
// doesn't match — that's a normal "let me try a different one"
// state, not an error.
export async function findDeviceByLabel(label: string): Promise<LotoDevice | null> {
  const { data, error } = await supabase
    .from('loto_devices')
    .select('*')
    .eq('device_label', label.trim())
    .eq('decommissioned', false)
    .maybeSingle()
  if (error) throw new Error(`findDeviceByLabel(${label}): ${error.message}`)
  return data as LotoDevice | null
}
