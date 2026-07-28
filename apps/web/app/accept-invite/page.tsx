'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, MailCheck, User as UserIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import PasswordField from '@/components/PasswordField'

// /accept-invite?token=<raw> — landing page for the invite-email link.
//
// The token (not a Supabase session) is the credential, so this page is
// in AuthGate's PUBLIC_PATHS. Flow: validate the token server-side
// (deterministic — no detectSessionInUrl, no timeout heuristics), let
// the recipient choose a name + password, POST /api/invites/accept,
// then sign in normally with the fresh credentials.

const MIN_PASSWORD_LENGTH = 8

type PageState =
  | 'checking'
  | 'form'
  | 'expired'        // expired or superseded — a fresh link can be requested
  | 'already_active' // accepted before, or the user has signed in already
  | 'cancelled'
  | 'invalid'
  | 'rate_limited'   // transient — too many checks from this IP
  | 'link_requested' // refresh succeeded; a new email is on its way

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>}>
      <AcceptInviteForm />
    </Suspense>
  )
}

function AcceptInviteForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Captured once rather than read live. The effect below depends on `token`,
  // and we strip the token from the URL after validating — reading it live
  // would flip it to '' on that rewrite, re-fire the effect, and land the
  // recipient on the "invalid link" screen mid-flow.
  const [token] = useState(() => searchParams.get('token') ?? '')

  const [state, setState]         = useState<PageState>('checking')
  const [email, setEmail]         = useState('')
  const [tenantName, setTenantName] = useState<string | null>(null)
  const [fullName, setFullName]   = useState('')
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [busy, setBusy]           = useState(false)
  const [error, setError]         = useState<string | null>(null)

  // Map an API token status onto a page state. Shared by the initial
  // validate and the accept-submit response so a token that expires while
  // the form sits open lands on the recoverable 'expired' screen instead
  // of a dead-end "try again" error.
  function applyStatus(status: string | undefined, data: { email?: string; fullName?: string; tenantName?: string | null }) {
    switch (status) {
      case 'valid':
        setEmail(data.email ?? '')
        setFullName(current => current || data.fullName || '')
        setTenantName(data.tenantName ?? null)
        setState('form')
        break
      case 'expired':
      case 'superseded':
        setState('expired'); break
      case 'used':
      case 'already_active':
        setState('already_active'); break
      case 'cancelled':
        setState('cancelled'); break
      default:
        setState('invalid')
    }
  }

  useEffect(() => {
    let cancelled = false
    async function validate() {
      if (!token) { setState('invalid'); return }
      try {
        const res = await fetch('/api/invites/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        // A 429 (scanner prefetch / shared egress IP) is transient, not a
        // bad link — don't tell a legitimate invitee their link is invalid.
        if (res.status === 429) { setState('rate_limited'); return }
        applyStatus(data.status, data)
        // Drop the credential from the address bar, browser history and any
        // Referer sent by later same-origin requests. Complements the URL
        // redaction in lib/security/scrubEvent.ts rather than replacing it —
        // Sentry patches replaceState and still records the prior URL.
        window.history.replaceState(null, '', '/accept-invite')
      } catch {
        if (!cancelled) setState('invalid')
      }
    }
    void validate()
    return () => { cancelled = true }
  }, [token])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)

    const trimmedName = fullName.trim()
    if (!trimmedName) { setError('Please enter your full name.'); return }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return
    }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setBusy(true)
    try {
      const res = await fetch('/api/invites/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, fullName: trimmedName, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setError('Too many attempts. Please wait a minute and try again.')
        return
      }
      if (!res.ok) {
        // The token can go stale between opening the form and submitting
        // (expiry, a resend, a concurrent accept). Those come back as a
        // status, not an error field — route them to the matching screen
        // (e.g. 'expired' → the "request a fresh link" recovery UI) rather
        // than a dead-end retry message.
        if (typeof data.status === 'string') { applyStatus(data.status, data); return }
        setError(typeof data.error === 'string' ? data.error : 'Could not accept the invitation. Please try again.')
        return
      }

      const { error: signInErr } = await supabase.auth.signInWithPassword({
        email: data.email ?? email,
        password,
      })
      // The account is fully set up either way; a sign-in hiccup just
      // means one extra manual login.
      if (signInErr) { router.replace('/login'); return }
      router.replace('/')
    } finally {
      setBusy(false)
    }
  }

  async function requestFreshLink() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/invites/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setError('Too many requests. Please wait a few minutes and try again.'); return
      }
      if (data.status === 'already_active') { setState('already_active'); return }
      if (data.status === 'cancelled') { setState('cancelled'); return }
      // A new token was minted, but email delivery is best-effort — don't
      // claim "on its way" when nothing actually sent.
      if (res.ok && data.ok && data.emailSent === false) {
        setError('We generated a new link but could not email it. Please contact your administrator.'); return
      }
      if (res.ok && data.ok) { setState('link_requested'); return }
      setError('Could not send a new link. Please contact your administrator.')
    } catch {
      setError('Could not send a new link. Please contact your administrator.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 p-6 space-y-5">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {tenantName ? `Join ${tenantName}` : 'Welcome to SoteriaField'}
          </h1>
          {state === 'form' && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Setting up the account for <span className="font-medium text-slate-700 dark:text-slate-300">{email}</span>.
            </p>
          )}
        </div>

        {state === 'checking' && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your invitation…
          </div>
        )}

        {state === 'rate_limited' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">Too many attempts right now.</p>
                <p className="text-xs mt-1 opacity-90">Your link is fine — please wait a minute, then try again.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
            >
              Try again
            </button>
          </div>
        )}

        {state === 'expired' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
              <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium">This invitation link has expired or been replaced.</p>
                <p className="text-xs mt-1 opacity-90">We can email a fresh link to the same address.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={requestFreshLink}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Sending…' : 'Email me a fresh link'}
            </button>
            {error && (
              <p className="text-sm font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>
            )}
          </div>
        )}

        {state === 'link_requested' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <MailCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800 dark:text-emerald-200">
              <p className="font-medium">A fresh invitation is on its way.</p>
              <p className="text-xs mt-1 opacity-90">Check your inbox (and spam folder) in the next few minutes.</p>
            </div>
          </div>
        )}

        {state === 'already_active' && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800 dark:text-emerald-200">
                <p className="font-medium">Your account is already set up.</p>
                <p className="text-xs mt-1 opacity-90">
                  Sign in with your password, or{' '}
                  <Link href="/forgot-password" className="underline">reset it</Link> if you&apos;ve forgotten it.
                </p>
              </div>
            </div>
            <Link
              href="/login"
              className="block w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold text-center hover:bg-brand-navy/90 transition-colors"
            >
              Go to sign in
            </Link>
          </div>
        )}

        {state === 'cancelled' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 dark:text-rose-200">
              <p className="font-medium">This invitation was cancelled.</p>
              <p className="text-xs mt-1 opacity-90">Contact your administrator to be re-invited.</p>
            </div>
          </div>
        )}

        {state === 'invalid' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 dark:text-rose-200">
              <p className="font-medium">This invitation link isn&apos;t valid.</p>
              <p className="text-xs mt-1 opacity-90">
                Double-check you opened the full link from the email. If you already have an account, you can{' '}
                <Link href="/forgot-password" className="text-brand-navy dark:text-brand-yellow hover:underline">reset your password</Link>.
              </p>
            </div>
          </div>
        )}

        {state === 'form' && (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Full name</span>
              <div className="relative mt-1">
                <UserIcon className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Choose a password</span>
              <div className="mt-1">
                <PasswordField
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </label>

            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Confirm password</span>
              <div className="mt-1">
                <PasswordField
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                />
              </div>
            </label>

            {error && (
              <p className="text-sm font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Setting up…' : 'Accept invitation'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
