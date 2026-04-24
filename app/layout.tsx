import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { UploadQueueProvider } from '@/components/UploadQueueProvider'
import { SessionProvider } from '@/components/SessionProvider'
import { AuthProvider } from '@/components/AuthProvider'
import AuthGate from '@/components/AuthGate'
import AppChrome from '@/components/AppChrome'
import IosSplashLinks from '@/components/IosSplashLinks'
import './globals.css'

const inter    = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Soteria LOTO Pro',
  description: 'Soteria LOTO Pro — real-time placard completion tracking for field teams',
  manifest: '/manifest.json',
  // Icons come from app/icon.tsx and app/apple-icon.tsx — Next auto-emits
  // <link rel="icon"> and <link rel="apple-touch-icon"> for those files.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Soteria LOTO Pro',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
}

// themeColor is managed via the viewport export (moved out of metadata in Next.js 14).
// viewportFit=cover lets env(safe-area-inset-*) return real values on notched
// iPhones/PWAs so we can pad the header/footer around the notch + home bar.
export const viewport: Viewport = {
  themeColor: '#1B3A6B',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        <IosSplashLinks />
      </head>
      <body className="min-h-full bg-slate-50">
        <AuthProvider>
          <SessionProvider>
            <UploadQueueProvider>
              <AuthGate>
                <AppChrome>{children}</AppChrome>
              </AuthGate>
            </UploadQueueProvider>
          </SessionProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
