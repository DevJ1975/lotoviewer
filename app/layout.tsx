import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import GlobalSearch from '@/components/GlobalSearch'
import OfflineBanner from '@/components/OfflineBanner'
import './globals.css'

const inter    = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Soteria LOTO Dashboard',
  description: 'Real-time LOTO placard completion status',
  manifest: '/manifest.json',
  icons: {
    icon:  '/icons/icon-192.svg',
    apple: '/icons/icon-192.svg',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Soteria LOTO',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

// themeColor is managed via the viewport export (moved out of metadata in Next.js 14)
export const viewport: Viewport = {
  themeColor: '#1B3A6B',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full bg-slate-50">
        <header className="bg-brand-navy border-b border-white/10 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-14">
              <Link href="/" className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-xs bg-brand-yellow text-brand-navy tracking-tight">
                  SL
                </div>
                <span className="text-white font-semibold text-[15px] tracking-tight">
                  Soteria <span className="text-brand-yellow font-bold">LOTO</span>
                </span>
              </Link>
              <GlobalSearch />
              <nav className="flex items-center gap-0.5">
                <NavLink href="/">Dashboard</NavLink>
                <NavLink href="/departments">Departments</NavLink>
                <NavLink href="/print">Print Queue</NavLink>
              </nav>
            </div>
          </div>
        </header>
        <OfflineBanner />
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </body>
    </html>
  )
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-full text-[13px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition-colors"
    >
      {children}
    </Link>
  )
}
