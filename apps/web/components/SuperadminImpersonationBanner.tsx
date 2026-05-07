'use client'

import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'

// Surfaced when a superadmin is acting on a tenant they're NOT a
// member of — i.e., visiting a customer's tenant via the switcher
// or via /superadmin/tenants/[number]. The banner makes the
// context obvious so accidental writes don't surprise the
// superadmin (and the customer doesn't see admin actions
// originating from a non-member).
//
// Mounts at the top of the app shell (AppChrome). No-op for
// regular tenant members.

export function SuperadminImpersonationBanner() {
  const { profile } = useAuth()
  const { tenant, available, switchTenant } = useTenant()

  if (!profile?.is_superadmin) return null
  if (!tenant) return null

  // If the active tenant IS in the user's membership list, they're
  // acting on their own home tenant — no banner needed.
  const isOwnTenant = available.some(t => t.id === tenant.id)
  if (isOwnTenant) return null

  // Pick a fallback "switch back" target: any tenant the user is
  // an actual member of. If none, link to /superadmin home.
  const fallback = available[0] ?? null

  return (
    <div className="bg-amber-100 dark:bg-amber-950/60 border-b border-amber-300 dark:border-amber-700 px-4 py-2 text-xs flex items-center gap-2 flex-wrap">
      <ShieldAlert className="h-4 w-4 text-amber-800 dark:text-amber-200 shrink-0" />
      <span className="text-amber-900 dark:text-amber-100">
        <strong>Superadmin context:</strong> viewing
        {' '}<span className="font-mono">{tenant.name}</span> (#{tenant.tenant_number}).
        Any writes will be attributed to you in this tenant&apos;s audit log.
      </span>
      <span className="ml-auto flex items-center gap-3">
        {fallback && (
          <button
            type="button"
            onClick={() => void switchTenant(fallback.id)}
            className="font-semibold text-amber-900 dark:text-amber-100 hover:underline"
          >
            Switch to {fallback.name}
          </button>
        )}
        <Link
          href="/superadmin"
          className="font-semibold text-amber-900 dark:text-amber-100 hover:underline"
        >
          Superadmin home
        </Link>
      </span>
    </div>
  )
}
