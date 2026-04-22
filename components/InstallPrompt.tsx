'use client'

import { useEffect, useState } from 'react'
import { Download, Share, X } from 'lucide-react'

const DISMISS_KEY = 'loto.install-dismissed-at'
const DISMISS_DAYS = 7
const MS_PER_DAY = 24 * 60 * 60 * 1000

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  // iOS Safari uses a non-standard navigator flag for home-screen apps.
  const navWithStandalone = window.navigator as Navigator & { standalone?: boolean }
  return navWithStandalone.standalone === true
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  // iPadOS 13+ reports "MacIntel" + touch; treat that as iOS too.
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua)
    || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
}

function recentlyDismissed(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY))
    if (!ts) return false
    return Date.now() - ts < DISMISS_DAYS * MS_PER_DAY
  } catch { return false }
}

function rememberDismiss(): void {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* private mode */ }
}

// Renders nothing on browsers that already installed the app, on platforms
// that can't install, or for a week after the user dismissed the prompt.
//
// On Chrome/Edge/Android: listens for `beforeinstallprompt` and shows a
// native-style install button.
// On iOS Safari: there's no install API — shows a small "Add to Home Screen"
// hint with the share-icon directions.
export default function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIosHint, setShowIosHint] = useState(false)

  useEffect(() => {
    if (isStandalone()) return
    if (recentlyDismissed()) return

    if (isIOS()) {
      setShowIosHint(true)
      return
    }

    const onPrompt = (e: Event) => {
      e.preventDefault()
      setEvent(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => setEvent(null)

    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function handleInstall() {
    if (!event) return
    await event.prompt()
    const { outcome } = await event.userChoice
    if (outcome === 'dismissed') rememberDismiss()
    setEvent(null)
  }

  function handleDismiss() {
    rememberDismiss()
    setEvent(null)
    setShowIosHint(false)
  }

  if (event) {
    return (
      <div
        role="region"
        aria-label="Install LOTO app"
        className="fixed left-4 right-4 bottom-4 sm:left-auto sm:right-6 sm:max-w-sm z-40 bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 p-4 flex items-center gap-3"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="w-10 h-10 rounded-xl bg-brand-navy text-brand-yellow font-bold text-sm flex items-center justify-center shrink-0">SL</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900">Install LOTO</p>
          <p className="text-xs text-slate-500">Faster launch and offline access.</p>
        </div>
        <button
          type="button"
          onClick={handleInstall}
          className="px-3 py-1.5 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors flex items-center gap-1.5"
        >
          <Download className="h-4 w-4" /> Install
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss"
          className="text-slate-400 hover:text-slate-600 p-1 rounded"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  if (showIosHint) {
    return (
      <div
        role="region"
        aria-label="Install LOTO on iOS"
        className="fixed left-4 right-4 bottom-4 sm:left-auto sm:right-6 sm:max-w-sm z-40 bg-white rounded-2xl shadow-2xl ring-1 ring-slate-200 p-4"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-navy text-brand-yellow font-bold text-sm flex items-center justify-center shrink-0">SL</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-900">Add LOTO to your Home Screen</p>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1 flex-wrap">
              Tap <Share className="h-3.5 w-3.5 inline-block text-blue-500" /> Share, then <span className="font-semibold">Add to Home Screen</span>.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss"
            className="text-slate-400 hover:text-slate-600 p-1 rounded shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    )
  }

  return null
}
