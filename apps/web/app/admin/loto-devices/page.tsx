'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, KeyRound, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import {
  loadAllDevices,
  loadOpenCheckouts,
  isStaleCheckout,
  STALE_CHECKOUT_HOURS,
  type OpenCheckoutRow,
} from '@/lib/queries/lotoDevices'
import type { LotoDevice, LotoDeviceStatus } from '@soteria/core/types'
import { AddDeviceForm }   from './_components/AddDeviceForm'
import { CheckoutDialog }  from './_components/CheckoutDialog'

const STATUS_BG: Record<LotoDeviceStatus, string> = {
  available:    'bg-emerald-100 text-emerald-800',
  checked_out:  'bg-amber-100 text-amber-800',
  maintenance:  'bg-slate-100 text-slate-700',
  lost:         'bg-rose-100 text-rose-800',
}

interface ProfileLite {
  id:        string
  email:     string | null
  full_name: string | null
}

export default function LotoDevicesPage() {
  const { profile, loading: authLoading } = useAuth()
  const [devices, setDevices]       = useState<LotoDevice[] | null>(null)
  const [openCheckouts, setOpenCheckouts] = useState<OpenCheckoutRow[] | null>(null)
  const [profileById, setProfileById] = useState<Map<string, ProfileLite>>(new Map())
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [busyId, setBusyId]         = useState<string | null>(null)
  const [checkoutFor, setCheckoutFor] = useState<LotoDevice | null>(null)
  const [now, setNow]               = useState(() => Date.now())

  // 1-min tick so the held-time pill in each open-checkout row updates
  // without a manual reload — the same pattern the home dashboard uses
  // for active permits.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [d, o] = await Promise.all([loadAllDevices(), loadOpenCheckouts()])
      setDevices(d)
      setOpenCheckouts(o)
      // Resolve profile names for the open-checkout owner column.
      const ownerIds = Array.from(new Set(o.map(r => r.checkout.owner_id)))
      if (ownerIds.length > 0) {
        const { data: profs } = await supabase
          .from('profiles')
          .select('id, email, full_name')
          .in('id', ownerIds)
        const m = new Map<string, ProfileLite>()
        for (const p of (profs ?? []) as ProfileLite[]) m.set(p.id, p)
        setProfileById(m)
      } else {
        setProfileById(new Map())
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load devices')
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Look up the open checkout for a given device — null when the
  // device is not currently checked out.
  const openByDeviceId = useMemo(() => {
    const m = new Map<string, OpenCheckoutRow>()
    for (const r of openCheckouts ?? []) m.set(r.checkout.device_id, r)
    return m
  }, [openCheckouts])

  async function returnDevice(device: LotoDevice) {
    if (!profile?.id) return
    if (!confirm(`Return ${device.device_label}? This closes the open checkout.`)) return
    setBusyId(device.id); setActionError(null)
    const open = openByDeviceId.get(device.id)
    if (!open) {
      setActionError('No open checkout found — already returned?')
      setBusyId(null)
      await load()
      return
    }
    // Two writes — close the checkout, clear the device pointer.
    const nowIso = new Date().toISOString()
    const { error: chkErr } = await supabase
      .from('loto_device_checkouts')
      .update({ returned_at: nowIso, returned_by: profile.id })
      .eq('id', open.checkout.id)
    if (chkErr) {
      setActionError(formatSupabaseError(chkErr, 'close checkout'))
      setBusyId(null)
      return
    }
    const { error: devErr } = await supabase
      .from('loto_devices')
      .update({ status: 'available', current_checkout_id: null })
      .eq('id', device.id)
    setBusyId(null)
    if (devErr) {
      setActionError(formatSupabaseError(devErr, 'mark device available'))
      return
    }
    await load()
  }

  async function markStatus(device: LotoDevice, status: LotoDeviceStatus) {
    setBusyId(device.id); setActionError(null)
    const { error: err } = await supabase
      .from('loto_devices')
      .update({ status })
      .eq('id', device.id)
    setBusyId(null)
    if (err) {
      setActionError(formatSupabaseError(err, 'update device'))
      return
    }
    await load()
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  const staleCheckouts = (openCheckouts ?? []).filter(r => isStaleCheckout(r.checkout, now))

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-brand-navy" />
          LOTO devices
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Physical lock + tag inventory. One row per individually-trackable lock.
          Status updates automatically when you record a checkout or return.
        </p>
      </div>

      {/* Stale-checkout banner — anything held >12h gets surfaced */}
      {staleCheckouts.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 p-4">
          <p className="text-sm font-bold text-rose-900 dark:text-rose-100">
            {staleCheckouts.length} device{staleCheckouts.length === 1 ? '' : 's'} held longer than {STALE_CHECKOUT_HOURS}h
          </p>
          <p className="text-[11px] text-rose-900/80 dark:text-rose-100/80 mt-0.5">
            Forgotten locks are the #1 LOTO violation. Reach out to each owner before they leave site.
          </p>
          <ul className="mt-2 text-[11px] text-rose-900/90 dark:text-rose-100/90 space-y-0.5">
            {staleCheckouts.slice(0, 5).map(r => {
              const owner = profileById.get(r.checkout.owner_id)
              const heldH = Math.floor((now - new Date(r.checkout.checked_out_at).getTime()) / 3_600_000)
              return (
                <li key={r.checkout.id}>
                  <span className="font-mono font-semibold">{r.device.device_label}</span>
                  {' — '}
                  {owner?.full_name || owner?.email || r.checkout.owner_id.slice(0, 8)}
                  {' · '}{heldH}h
                  {r.checkout.equipment_id && <> · {r.checkout.equipment_id}</>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <AddDeviceForm onAdded={load} />

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}
      {actionError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {actionError}
        </div>
      )}

      {/* Inventory list */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Inventory</h2>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">
            {devices?.length ?? 0} devices
          </span>
        </header>
        {devices === null ? (
          <div className="py-6 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : devices.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            No devices yet. Use the form above to add the first lock.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                  <th className="pb-2 pr-2">Label</th>
                  <th className="pb-2 pr-2">Kind</th>
                  <th className="pb-2 pr-2">Status</th>
                  <th className="pb-2 pr-2">Holder · Equipment</th>
                  <th className="pb-2 pl-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {devices.map(d => {
                  const open = openByDeviceId.get(d.id)
                  const owner = open ? profileById.get(open.checkout.owner_id) : null
                  const isBusy = busyId === d.id
                  return (
                    <tr key={d.id}>
                      <td className="py-2 pr-2 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {d.device_label}
                        {d.description && (
                          <span className="block text-[10px] font-sans font-normal text-slate-500 dark:text-slate-400">
                            {d.description}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-slate-500 dark:text-slate-400 capitalize">
                        {d.kind.replace('_', ' ')}
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded ${STATUS_BG[d.status]}`}>
                          {d.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="py-2 pr-2 text-slate-500 dark:text-slate-400">
                        {open ? (
                          <>
                            {owner?.full_name || owner?.email || open.checkout.owner_id.slice(0, 8)}
                            {open.checkout.equipment_id && <> · <span className="font-mono">{open.checkout.equipment_id}</span></>}
                          </>
                        ) : '—'}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <div className="inline-flex items-center gap-1">
                          {d.status === 'available' && (
                            <>
                              <button
                                type="button"
                                onClick={() => setCheckoutFor(d)}
                                disabled={isBusy}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold border border-amber-200 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 hover:bg-amber-100 disabled:opacity-50"
                              >
                                Check out
                              </button>
                              <button
                                type="button"
                                onClick={() => markStatus(d, 'maintenance')}
                                disabled={isBusy}
                                className="px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40 disabled:opacity-50"
                              >
                                Maintenance
                              </button>
                            </>
                          )}
                          {d.status === 'checked_out' && (
                            <button
                              type="button"
                              onClick={() => returnDevice(d)}
                              disabled={isBusy}
                              className="px-2 py-1 rounded-md text-[11px] font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                            >
                              Return
                            </button>
                          )}
                          {d.status === 'maintenance' && (
                            <button
                              type="button"
                              onClick={() => markStatus(d, 'available')}
                              disabled={isBusy}
                              className="px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40 disabled:opacity-50"
                            >
                              Restore
                            </button>
                          )}
                          {d.status === 'lost' && (
                            <button
                              type="button"
                              onClick={() => markStatus(d, 'available')}
                              disabled={isBusy}
                              className="px-2 py-1 rounded-md text-[11px] font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/40 disabled:opacity-50"
                            >
                              Found
                            </button>
                          )}
                          {d.status !== 'lost' && d.status !== 'checked_out' && (
                            <button
                              type="button"
                              onClick={() => markStatus(d, 'lost')}
                              disabled={isBusy}
                              className="px-2 py-1 rounded-md text-[11px] font-semibold border border-rose-200 text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 disabled:opacity-50"
                            >
                              Lost
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {checkoutFor && (
        <CheckoutDialog
          device={checkoutFor}
          onClose={() => setCheckoutFor(null)}
          onCheckedOut={() => { setCheckoutFor(null); load() }}
        />
      )}
    </div>
  )
}
