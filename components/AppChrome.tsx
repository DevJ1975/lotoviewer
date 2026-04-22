'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'
import { Menu, X } from 'lucide-react'
import GlobalSearch from '@/components/GlobalSearch'
import Greeting from '@/components/Greeting'
import UserMenu from '@/components/UserMenu'
import { useAuth } from '@/components/AuthProvider'
import { requestPersistentStorage } from '@/lib/platform'

const PUBLIC_PATHS = new Set(['/login', '/welcome'])

const NAV_LINKS: { href: string; label: string }[] = [
  { href: '/',             label: 'Dashboard' },
  { href: '/status',       label: 'Status' },
  { href: '/departments',  label: 'Departments' },
  { href: '/print',        label: 'Print Queue' },
  { href: '/import',       label: 'Import' },
  { href: '/decommission', label: 'Decommission' },
]

// Wraps the app shell (header, footer) so it only renders on authenticated
// routes. /login and /welcome get a bare layout — no brand nav, no greeting.
// Responsive: horizontal nav on lg+, hamburger drawer on mobile/iPad portrait.
export default function AppChrome({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { userId, loading } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const hideChrome = PUBLIC_PATHS.has(pathname) || (!loading && !userId)

  // Close the drawer when the user navigates.
  useEffect(() => { setMenuOpen(false) }, [pathname])

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!menuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [menuOpen])

  // Ask the browser to keep our IndexedDB / Cache Storage alive under
  // storage pressure. Fire once per session after the user is authenticated
  // — pre-login this would be noise.
  useEffect(() => {
    if (userId) requestPersistentStorage()
  }, [userId])

  if (hideChrome) return <>{children}</>

  return (
    <>
      <header
        className="bg-brand-navy border-b border-white/10 sticky top-0 z-50"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 gap-2 sm:gap-4">
            {/* Mobile: hamburger on the left */}
            <button
              type="button"
              onClick={() => setMenuOpen(o => !o)}
              aria-label="Toggle navigation"
              aria-expanded={menuOpen}
              className="lg:hidden text-white/80 hover:text-white hover:bg-white/10 rounded-md h-10 w-10 flex items-center justify-center transition-colors"
            >
              {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>

            <Link href="/" className="flex items-center gap-2 shrink-0 min-w-0">
              <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs bg-brand-yellow text-brand-navy tracking-tight shrink-0">
                SL
              </div>
              <span className="hidden xs:inline sm:inline text-white font-semibold text-[15px] tracking-tight truncate">
                Soteria <span className="text-brand-yellow font-bold">LOTO</span>
              </span>
            </Link>

            {/* Desktop search — hidden on mobile to save width */}
            <div className="hidden md:block flex-1 min-w-0 max-w-md">
              <GlobalSearch />
            </div>

            {/* Desktop nav — hidden below lg */}
            <nav className="hidden lg:flex items-center gap-0.5">
              {NAV_LINKS.map(l => (
                <NavLink key={l.href} href={l.href}>{l.label}</NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-2 sm:gap-3 shrink-0 ml-auto lg:ml-0">
              <Greeting className="hidden md:inline-flex text-white/80" />
              <UserMenu />
            </div>
          </div>

          {/* Mobile search row — shows below md (hidden when md+ already has it in header) */}
          <div className="md:hidden pb-2">
            <GlobalSearch />
          </div>
        </div>

        {/* Mobile drawer */}
        {menuOpen && (
          <div className="lg:hidden fixed inset-0 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            />
            <nav className="relative bg-brand-navy border-b border-white/10 max-h-[calc(100vh-3.5rem)] overflow-y-auto px-2 py-3 space-y-1">
              {NAV_LINKS.map(l => (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`block px-4 py-3 rounded-lg text-[15px] font-medium transition-colors min-h-[44px] flex items-center ${
                    pathname === l.href ? 'bg-white/15 text-white' : 'text-white/80 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        )}
      </header>

      <main>{children}</main>

      <footer
        className="bg-white border-t border-slate-200 py-3 text-center text-xs text-slate-500"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        Developed by Jamil Jones · Copyright 2026
      </footer>
    </>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-full text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
    >
      {children}
    </Link>
  )
}
