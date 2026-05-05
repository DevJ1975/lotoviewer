'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import GlobalSearch from '@/components/GlobalSearch'
import Greeting from '@/components/Greeting'
import UserMenu from '@/components/UserMenu'
import OfflineBanner from '@/components/OfflineBanner'
import PwaRegister from '@/components/PwaRegister'
import InstallPrompt from '@/components/InstallPrompt'
import UpdateBanner from '@/components/UpdateBanner'
import UnloadGuard from '@/components/UnloadGuard'
import IdleLogout from '@/components/IdleLogout'
import StorageQuotaBanner from '@/components/StorageQuotaBanner'
import AppDrawer from '@/components/AppDrawer'
import TenantHeaderPill from '@/components/TenantHeaderPill'
import SupportBot from '@/components/SupportBot'
import { useAuth } from '@/components/AuthProvider'
import { requestPersistentStorage } from '@/lib/platform'

const PUBLIC_PATHS = new Set(['/login', '/welcome'])

// Wraps the app shell (header, footer) so it only renders on authenticated
// routes. /login and /welcome get a bare layout — no brand nav, no greeting.
//
// All feature navigation lives in the side drawer (components/AppDrawer.tsx)
// driven by lib/features.ts. The chrome holds only the drawer trigger,
// the brand, the global search, and the user menu — keeping the bar
// uncluttered as more modules ship.
export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { userId, loading } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const hideChrome = PUBLIC_PATHS.has(pathname) || (!loading && !userId)

  // Close the drawer on route change so navigating from inside the drawer
  // doesn't leave it sitting open over the new page.
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Ask the browser to keep our IndexedDB / Cache Storage alive under
  // storage pressure. Fire once per session after the user is authenticated.
  useEffect(() => {
    if (userId) requestPersistentStorage()
  }, [userId])

  if (hideChrome) return <><PwaRegister />{children}</>

  return (
    <>
      <header
        className="bg-brand-navy border-b border-white/10 sticky top-0 z-40"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              className="text-white/80 hover:text-white hover:bg-white/10 dark:hover:bg-slate-900/10 rounded-md h-10 w-10 flex items-center justify-center transition-colors shrink-0"
            >
              <Menu className="h-5 w-5" />
            </button>

            <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0">
              <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs bg-brand-yellow text-brand-navy tracking-tight shrink-0">
                SL
              </div>
              <span className="hidden xs:inline sm:inline text-white font-semibold text-[15px] tracking-tight truncate">
                Soteria <span className="text-brand-yellow font-bold tracking-wider">FIELD</span>
              </span>
            </Link>

            <TenantHeaderPill />

            <div className="hidden md:block flex-1 min-w-0 max-w-md">
              <GlobalSearch />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
              <Greeting className="hidden md:inline-flex text-white/80" />
              <UserMenu />
            </div>
          </div>

          {/* Mobile search row — shows below md */}
          <div className="md:hidden pb-2">
            <GlobalSearch />
          </div>
        </div>
      </header>

      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <PwaRegister />
      <OfflineBanner />
      <StorageQuotaBanner />
      <main>{children}</main>
      <InstallPrompt />
      <UpdateBanner />
      <UnloadGuard />
      <IdleLogout />
      <SupportBot />

      <footer
        className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-3 text-xs text-slate-500 dark:text-slate-400"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Powered by Trainovate Technologies LLC · Copyright 2026</span>
          <span className="flex items-center gap-3">
            <Link href="/privacy" className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors">Privacy</Link>
            <span aria-hidden="true">·</span>
            <Link href="/terms"   className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors">Terms</Link>
          </span>
        </div>
      </footer>
    </>
  )
}
