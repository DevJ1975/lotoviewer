'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell, BellOff, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { urlBase64ToUint8Array } from '@/lib/push'

// User-facing toggle for Web Push notifications. Only displayed when the
// browser supports the relevant APIs (serviceWorker + PushManager +
// Notification). On iOS the PWA must be installed to home screen first;
// we surface that hint when the install state matches.

export default function NotificationsSettingsPage() {
  const { profile, loading: authLoading } = useAuth()
  const [supported, setSupported]   = useState<boolean | null>(null)  // null = checking
  const [permission, setPermission] = useState<NotificationPermission | null>(null)
  const [subscribed, setSubscribed] = useState<boolean | null>(null)
  const [busy, setBusy]             = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [okMsg, setOkMsg]           = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const ok =
      'serviceWorker'  in navigator &&
      'PushManager'    in window &&
      'Notification'   in window
    setSupported(ok)
    if (ok) {
      setPermission(Notification.permission)
      navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription())
        .then(sub => setSubscribed(!!sub))
        .catch(() => setSubscribed(false))
    }
  }, [])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Sign in to manage notifications.</div>
  }

  async function enable() {
    setError(null); setOkMsg(null); setBusy(true)
    try {
      // Permission. iOS PWA requires this to be triggered from a user
      // gesture, which the click on this button satisfies.
      let perm = Notification.permission
      if (perm === 'default') perm = await Notification.requestPermission()
      setPermission(perm)
      if (perm !== 'granted') throw new Error('Notification permission was not granted.')

      // VAPID public key — the browser uses this to verify the eventual
      // pushes really came from us. Must be set in env at build time.
      const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!vapid) throw new Error('Push notifications not configured (NEXT_PUBLIC_VAPID_PUBLIC_KEY missing).')

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      })
      const json = sub.toJSON()
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not signed in.')

      const res = await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          endpoint:   sub.endpoint,
          p256dh:     json.keys?.p256dh,
          auth:       json.keys?.auth,
          user_agent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `Server returned ${res.status}`)
      }
      setSubscribed(true)
      setOkMsg('Notifications enabled on this device.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable notifications.')
    } finally {
      setBusy(false)
    }
  }

  async function sendTest() {
    setError(null); setOkMsg(null); setBusy(true)
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Not signed in.')
      const res = await fetch('/api/push/dispatch', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: 'Soteria FIELD test',
          body:  'If you see this, Web Push is working on this device.',
          tag:   'push-self-test',
          // Limit to the current user only — don't blast every device.
          profile_ids: [profile?.id],
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      setOkMsg(`Test sent — sent: ${j.sent}, failed: ${j.failed}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send test.')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    setError(null); setOkMsg(null); setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        // Tell the server first so the row is gone before unsubscribe
        // invalidates the endpoint upstream.
        const session = await supabase.auth.getSession()
        const token = session.data.session?.access_token
        if (token) {
          await fetch('/api/push/subscribe', {
            method:  'DELETE',
            headers: {
              'Content-Type':  'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          })
        }
        await sub.unsubscribe()
      }
      setSubscribed(false)
      setOkMsg('Notifications disabled on this device.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disable notifications.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Bell className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            Notifications
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Enable push notifications on this device for permit + atmospheric-test alerts.
          </p>
        </div>
      </header>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
        {supported === null ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Checking browser capabilities…</p>
        ) : !supported ? (
          <div className="rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 p-3 space-y-1">
            <p className="text-sm font-bold text-amber-900 dark:text-amber-100">Push notifications unavailable.</p>
            <p className="text-xs text-amber-900/80 dark:text-amber-100/80">
              Your browser doesn't expose the Push API. On iPad, install Soteria FIELD to your home screen
              (Share → Add to Home Screen) and open it from there — Web Push only works in installed PWAs on iOS.
            </p>
          </div>
        ) : permission === 'denied' ? (
          <div className="rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 p-3 space-y-1">
            <p className="text-sm font-bold text-rose-900 dark:text-rose-100">Permission blocked.</p>
            <p className="text-xs text-rose-900/80 dark:text-rose-100/80">
              You previously denied notification permission in this browser. To re-enable, open your browser's
              site settings for Soteria FIELD and switch Notifications to Allow, then reload.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <p className="text-sm font-bold text-slate-900 dark:text-slate-100">Status</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {subscribed === null
                    ? 'Checking…'
                    : subscribed
                    ? 'Enabled on this device'
                    : 'Not enabled on this device'}
                </p>
              </div>
              {subscribed ? (
                <button
                  type="button"
                  onClick={disable}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-sm font-semibold hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 transition-colors"
                >
                  <BellOff className="h-4 w-4" />
                  {busy ? 'Disabling…' : 'Disable notifications'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={enable}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50 transition-colors"
                >
                  <Bell className="h-4 w-4" />
                  {busy ? 'Enabling…' : 'Enable notifications'}
                </button>
              )}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              You'll receive an alert when an atmospheric reading fails or when one of your permits is about
              to expire. Each device has to be enabled separately. You can disable any time.
            </p>
            {/* Admin-only self-test. Sends a push only to the current
                profile so it's safe to click on a noisy production org. */}
            {profile.is_admin && subscribed && (
              <button
                type="button"
                onClick={sendTest}
                disabled={busy}
                className="text-[11px] font-semibold text-brand-navy hover:underline disabled:opacity-50"
              >
                Send a test push to this device →
              </button>
            )}
          </div>
        )}

        {error && <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{error}</p>}
        {okMsg && <p className="text-xs text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 rounded-md px-3 py-2">{okMsg}</p>}
      </section>
    </div>
  )
}
