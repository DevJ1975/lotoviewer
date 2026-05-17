'use client'

import Link from 'next/link'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { ADMIN_SECTIONS, SETTINGS_NOTIFICATIONS_TILE, type AdminTile } from '@/lib/adminCatalog'

// Admin landing index. The catalog at lib/adminCatalog.ts is the
// single source of truth; this page just renders it. Per-route role
// gates still live on each destination page — this is a directory,
// not an authorization boundary.

export default function AdminHome() {
  const { profile, loading: authLoading } = useAuth()
  const { tenant, loading: tenantLoading } = useTenant()
  const canManage = !!profile?.is_admin || !!profile?.is_superadmin

  if (authLoading || tenantLoading) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    )
  }

  if (!canManage) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <p className="text-sm text-slate-500">Admins only.</p>
      </main>
    )
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8">
        <p className="text-[11px] font-bold uppercase tracking-widest text-brand-navy dark:text-brand-yellow">
          Administration
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950 dark:text-slate-50 sm:text-3xl">
          Tenant administration
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          Configuration, identity, evidence, and operations for{' '}
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {tenant?.name ?? 'your tenant'}
          </span>. Changes here apply across the whole tenant; per-user
          settings live under <Link href="/settings" className="underline">Settings</Link>.
        </p>
      </header>

      <div className="space-y-8">
        {ADMIN_SECTIONS.map(section => (
          <section key={section.id}>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {section.title}
              </h2>
              <p className="hidden text-xs text-slate-400 dark:text-slate-500 sm:block">
                {section.description}
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {section.tiles.map(tile => (
                <li key={tile.href}>
                  <TileLink tile={tile} />
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section>
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              Personal
            </h2>
            <p className="hidden text-xs text-slate-400 dark:text-slate-500 sm:block">
              Settings scoped to your account, not the tenant.
            </p>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <li>
              <TileLink tile={SETTINGS_NOTIFICATIONS_TILE} />
            </li>
          </ul>
        </section>

        {profile?.is_superadmin && (
          <section>
            <div className="mb-3 flex items-baseline gap-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                Cross-tenant
              </h2>
              <p className="hidden text-xs text-slate-400 dark:text-slate-500 sm:block">
                Operator tools that span every tenant. Use with care.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <li>
                <Link
                  href="/superadmin"
                  className="group block rounded-xl border-2 border-amber-200 bg-amber-50 p-5 transition-all hover:border-brand-navy hover:shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:border-brand-yellow"
                >
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700 dark:text-amber-300" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                          Platform operator
                        </h3>
                        <ArrowRight className="h-4 w-4 shrink-0 text-amber-400 transition-colors group-hover:text-brand-navy dark:group-hover:text-brand-yellow" />
                      </div>
                      <p className="mt-1 text-xs leading-snug text-slate-600 dark:text-slate-300">
                        Cross-tenant search, health, identity drift, migrations, and more.
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

function TileLink({ tile }: { tile: AdminTile }) {
  const Icon = tile.icon
  return (
    <Link
      href={tile.href}
      className="group block rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-brand-navy hover:shadow-sm dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-brand-yellow"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-navy dark:text-brand-yellow" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              {tile.title}
            </h3>
            <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-brand-navy dark:text-slate-600 dark:group-hover:text-brand-yellow" />
          </div>
          <p className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">
            {tile.desc}
          </p>
        </div>
      </div>
    </Link>
  )
}
