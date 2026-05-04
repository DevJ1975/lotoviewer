'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Check, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import type { Tenant } from '@/lib/types'

// Tenant indicator + switcher in the app header. Three modes:
//
//   1. Loading / no tenant → renders nothing
//   2. Single membership, not superadmin → renders a non-interactive pill
//      (logo + name + #0001 + DEMO badge if applicable)
//   3. Multiple memberships OR superadmin → renders a dropdown trigger.
//      Superadmin sees all tenants; others see only their memberships.
//
// Switching writes the new active tenant to sessionStorage; the supabase
// fetch wrapper picks up the header on the next request and migration
// 032's RLS scopes the data accordingly.

const COLOR_PALETTE = [
  'bg-emerald-500', 'bg-sky-500', 'bg-violet-500',
  'bg-amber-500',   'bg-rose-500', 'bg-teal-500',
  'bg-fuchsia-500', 'bg-indigo-500',
] as const

function colorFromSlug(slug: string): string {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length]!
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default function TenantHeaderPill() {
  const { tenant, available, loading, switchTenant } = useTenant()
  const { profile } = useAuth()
  const [open, setOpen] = useState(false)
  const [allTenants, setAllTenants] = useState<Tenant[] | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Dismiss on outside click / Esc.
  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Superadmin: load all tenants once on first dropdown open. RLS lets
  // is_superadmin read every row in tenants.
  useEffect(() => {
    if (!open || !profile?.is_superadmin || allTenants !== null || loadingAll) return
    setLoadingAll(true)
    void supabase
      .from('tenants')
      .select('*')
      .order('tenant_number', { ascending: true })
      .then(({ data }) => {
        setAllTenants((data ?? []) as Tenant[])
        setLoadingAll(false)
      })
  }, [open, profile?.is_superadmin, allTenants, loadingAll])

  if (loading || !tenant) return null

  const isSuperadmin    = !!profile?.is_superadmin
  const memberOfMany    = available.length > 1
  const interactive     = isSuperadmin || memberOfMany

  // Compose the option list. Superadmin sees every tenant; others only
  // their memberships. Mark the active one with a check.
  const options: Tenant[] = isSuperadmin
    ? (allTenants ?? available)
    : available

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => interactive && setOpen(o => !o)}
        disabled={!interactive}
        aria-haspopup={interactive ? 'menu' : undefined}
        aria-expanded={interactive ? open : undefined}
        className={`flex items-center gap-2 min-w-0 px-2 py-1 rounded-md bg-white/5 transition-colors ${
          interactive ? 'hover:bg-white/10 cursor-pointer' : 'cursor-default'
        }`}
      >
        <PillContents tenant={tenant} />
        {interactive && (
          <ChevronDown className={`h-3.5 w-3.5 text-white/60 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
        )}
      </button>

      {open && interactive && (
        <div
          role="menu"
          className="absolute left-0 top-full mt-1 w-72 max-h-[60vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-lg shadow-2xl border border-slate-200 dark:border-slate-700 z-50"
        >
          {isSuperadmin && (
            <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-widest text-slate-400 dark:text-slate-500 font-semibold">
              Superadmin — all tenants
            </p>
          )}
          {loadingAll && (
            <div className="px-3 py-4 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading tenants…
            </div>
          )}
          {!loadingAll && options.length === 0 && (
            <p className="px-3 py-4 text-sm text-slate-500 dark:text-slate-400">No tenants available.</p>
          )}
          {!loadingAll && options.map(t => {
            const isActive = t.id === tenant.id
            return (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => { switchTenant(t.id); setOpen(false) }}
                className={`w-full text-left px-3 py-2 flex items-center gap-2 transition-colors ${
                  isActive
                    ? 'bg-brand-navy/5 dark:bg-brand-navy/30'
                    : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'
                }`}
              >
                <RowMark tenant={t} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                    {t.name}
                    {t.is_demo && (
                      <span className="inline-flex items-center px-1 py-0 rounded text-[9px] font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">
                        Demo
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    #{t.tenant_number} · {t.slug}
                  </div>
                </div>
                {isActive && <Check className="h-4 w-4 text-brand-navy dark:text-brand-yellow shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PillContents({ tenant }: { tenant: Tenant }) {
  const colorClass = colorFromSlug(tenant.slug)
  return (
    <>
      {tenant.logo_url ? (
        <Image
          src={tenant.logo_url}
          alt={`${tenant.name} logo`}
          width={28}
          height={28}
          className="h-7 w-7 rounded-md object-contain bg-white shrink-0"
          unoptimized
        />
      ) : (
        <div
          className={`h-7 w-7 rounded-md flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${colorClass}`}
          aria-hidden="true"
        >
          {initials(tenant.name)}
        </div>
      )}
      <span className="hidden sm:inline text-white/90 text-sm font-medium truncate max-w-[140px]">
        {tenant.name}
      </span>
      <span className="text-white/50 text-xs font-mono tracking-tight tabular-nums">
        #{tenant.tenant_number}
      </span>
      {tenant.is_demo && (
        <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">
          Demo
        </span>
      )}
    </>
  )
}

function RowMark({ tenant }: { tenant: Tenant }) {
  const colorClass = colorFromSlug(tenant.slug)
  if (tenant.logo_url) {
    return (
      <Image
        src={tenant.logo_url}
        alt=""
        width={24}
        height={24}
        className="h-6 w-6 rounded object-contain bg-white shrink-0"
        unoptimized
      />
    )
  }
  return (
    <div
      className={`h-6 w-6 rounded flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${colorClass}`}
      aria-hidden="true"
    >
      {initials(tenant.name)}
    </div>
  )
}
