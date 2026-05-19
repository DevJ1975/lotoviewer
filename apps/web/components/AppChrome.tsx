'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Menu } from 'lucide-react'
import { SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
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
import { SuperadminImpersonationBanner } from '@/components/SuperadminImpersonationBanner'
import { ReleaseNotesBanner } from '@/components/ReleaseNotesBanner'
import { VERSION_LINE } from '@/lib/version'
import AppDrawer from '@/components/AppDrawer'
import CommandPalette from '@/components/CommandPalette'
import TenantHeaderPill from '@/components/TenantHeaderPill'
import SupportBot from '@/components/SupportBot'
import AssistantDock from '@/components/AssistantDock'
import ChatHeaderButton from '@/components/chat/ChatHeaderButton'
import HelpHeaderButton from '@/components/manuals/HelpHeaderButton'
import SoteriaLogo from '@/components/SoteriaLogo'
import { useAuth } from '@/components/AuthProvider'
import { requestPersistentStorage } from '@/lib/platform'
import { getModuleVisualsForPath } from '@/lib/moduleVisuals'
import { pushRecent } from '@/lib/recentRoutes'
import { useTenant } from '@/components/TenantProvider'

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
  const { tenant } = useTenant()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const hideChrome = PUBLIC_PATHS.has(pathname) || (!loading && !userId)

  // Close the drawer on route change so navigating from inside the drawer
  // doesn't leave it sitting open over the new page.
  useEffect(() => { setDrawerOpen(false) }, [pathname])

  // Record the current path in the per-tenant Recents list. Excluded
  // paths (dashboard, /welcome, login, raw /admin and /superadmin
  // landings) are filtered inside pushRecent itself.
  useEffect(() => {
    if (!tenant?.id || !userId) return
    pushRecent(tenant.id, pathname)
  }, [pathname, tenant?.id, userId])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Ask the browser to keep our IndexedDB / Cache Storage alive under
  // storage pressure. Fire once per session after the user is authenticated.
  useEffect(() => {
    if (userId) requestPersistentStorage()
  }, [userId])

  // Resolve the accent color for the active module (matches the
  // longest-prefix module href). Falls back to slate on the dashboard
  // and any non-module route. The strip sits below the chrome header
  // and stays sticky alongside it as a persistent "you are here" cue.
  const { classes: accentClasses } = getModuleVisualsForPath(pathname)
  // Cross-tenant operator mode. /superadmin/* surfaces use a distinct
  // accent + a header pill so a user with both roles can never mistake
  // the platform-operator surface for tenant administration.
  const inPlatformOpsMode = pathname.startsWith('/superadmin')

  if (hideChrome) return <><PwaRegister />{children}</>

  return (
    <SidebarProvider open={drawerOpen} onOpenChange={setDrawerOpen}>
      <header
        className={`sticky top-0 z-40 border-b border-[#0a1322]/80 bg-[#0E1A2E] text-white steel-scanlines motion-reactive ${
          scrolled ? 'shadow-[0_12px_28px_rgba(2,8,23,0.34)]' : 'shadow-[0_1px_0_rgba(255,255,255,0.04)]'
        }`}
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        {/* Hazard stripe — universal safety vocabulary. Sits above the
            nav so the very first pixels of the app read "industrial
            ops tool" rather than "generic SaaS dashboard." */}
        <div className="h-1.5 hazard-stripe-thin" aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className={`flex items-center justify-between gap-2 sm:gap-4 motion-reactive ${scrolled ? 'h-12' : 'h-14'}`}>
            <SidebarTrigger className="motion-press shrink-0 rounded-md border border-white/10 bg-white/[0.06] text-white/85 hover:bg-white/[0.12] hover:text-white active:bg-white/15 focus-visible:ring-white/40">
              <Menu className="h-5 w-5" />
            </SidebarTrigger>

            <Link href="/" className="flex items-center shrink-0 min-w-0" aria-label="SoteriaField home">
              <SoteriaLogo variant="color" width={160} priority className="h-9 w-auto" />
            </Link>

            <TenantHeaderPill />

            {inPlatformOpsMode && (
              <span
                className="shrink-0 rounded-md border border-amber-400/60 bg-amber-400/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-200"
                title="You are in the platform-operator surface. Actions here cross tenant boundaries."
              >
                Platform Ops
              </span>
            )}

            <div className="hidden md:block flex-1 min-w-0 max-w-md">
              <GlobalSearch />
            </div>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto">
              <Greeting className="hidden md:inline-flex text-white/80" />
              <HelpHeaderButton />
              <ChatHeaderButton />
              <UserMenu />
            </div>
          </div>

          {/* Mobile search row — shows below md */}
          <div className="md:hidden pb-2 animate-panel-in">
            <GlobalSearch />
          </div>
        </div>
      </header>

      {/* Module accent strip — picks up the active module's color so the
          user always knows which module they're in, even when scrolling
          through long content. Sticks below the chrome header. The
          +0.375rem accounts for the hazard stripe sitting above the
          main header row. In platform-ops mode we override to amber so
          the cross-tenant context reads as cautionary, not branded. */}
      <div
        className={`h-[3px] sticky z-30 motion-reactive ${inPlatformOpsMode ? 'bg-amber-400/80' : accentClasses.strip}`}
        style={{ top: `calc(${scrolled ? '3.375rem' : '3.875rem'} + env(safe-area-inset-top))` }}
        aria-hidden="true"
      />

      <AppDrawer onClose={() => setDrawerOpen(false)} />

      {/* Global ⌘K / Ctrl+K command palette — listens for the chord
          itself; we just mount it. Complements the per-resource
          GlobalSearch above (equipment lookup) with cross-feature
          navigation. */}
      <CommandPalette />

      <PwaRegister />
      <OfflineBanner />
      <SuperadminImpersonationBanner />
      <ReleaseNotesBanner />
      <StorageQuotaBanner />
      <main className="ops-shell min-h-[calc(100vh-12rem)]">{children}</main>
      <InstallPrompt />
      <UpdateBanner />
      <UnloadGuard />
      <IdleLogout />
      <SupportBot />
      <AssistantDock />

      <footer
        className="mt-0 border-t-2 border-slate-300/80 bg-white/90 py-4 text-xs text-slate-500 backdrop-blur dark:border-slate-800/70 dark:bg-slate-950/90 dark:text-slate-400"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
      >
        {/* Hazard-stripe cap mirrors the one at the top of the header,
            framing the entire shell like a piece of safety equipment. */}
        <div className="-mt-4 mb-4 h-1 hazard-stripe-thin opacity-80" aria-hidden="true" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3">
          <span className="placard-label text-slate-500 dark:text-slate-500">
            Powered by <span className="text-slate-700 dark:text-slate-300">Trainovate Technologies</span>
            <span className="text-slate-400 dark:text-slate-500"> · © 2026</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="placard-numeric text-[11px] text-slate-400 dark:text-slate-500" title={VERSION_LINE}>
              {VERSION_LINE}
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <Link href="/privacy" className="placard-label hover:text-slate-800 dark:hover:text-slate-200 transition-colors">Privacy</Link>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
            <Link href="/terms"   className="placard-label hover:text-slate-800 dark:hover:text-slate-200 transition-colors">Terms</Link>
          </span>
        </div>
      </footer>
    </SidebarProvider>
  )
}
