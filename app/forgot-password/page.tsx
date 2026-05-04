'use client'

import Link from 'next/link'
import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Mail, CheckCircle2, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// /forgot-password — public route. User enters their email; we ask
// Supabase to email them a one-time reset link. The link lands on
// /reset-password (handled by Supabase's redirectTo param) where the
// user sets a new password.
//
// LEARN: Supabase's resetPasswordForEmail does NOT confirm whether the
// email exists in auth.users — it returns success either way. This is
// a deliberate security choice (don't leak which emails are registered).
// We mirror that by always showing the same "If an account exists,
// you'll receive an email" message regardless of the actual outcome.

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>}>
      <ForgotPasswordForm />
    </Suspense>
  )
}

function ForgotPasswordForm() {
  const search = useSearchParams()
  const [email,   setEmail]   = useState(search.get('email') ?? '')
  const [busy,    setBusy]    = useState(false)
  const [done,    setDone]    = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)

    // The redirectTo URL is where Supabase sends the user after they
    // click the email link. Must be on the allowlist in Supabase
    // dashboard → Authentication → URL Configuration → Redirect URLs.
    // We resolve it from the current origin so this works on
    // production, preview deploys, and localhost without code changes.
    const redirectTo = `${window.location.origin}/reset-password`

    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo },
    )

    setBusy(false)
    if (err) {
      setError(err.message)
    } else {
      setDone(true)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 p-6 space-y-5">
        <Link href="/login" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Back to sign in
        </Link>

        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Forgot your password?</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            We&apos;ll email you a link to reset it.
          </p>
        </div>

        {done ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800 dark:text-emerald-200">
                <p className="font-medium">Check your inbox.</p>
                <p className="text-xs mt-1 opacity-90">
                  If an account exists for <span className="font-mono">{email}</span>, a
                  reset link is on the way. The link expires in one hour.
                </p>
              </div>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Didn&apos;t receive it? Check your spam folder, or
              {' '}
              <button type="button" onClick={() => setDone(false)} className="text-brand-navy dark:text-brand-yellow hover:underline">
                try a different email
              </button>.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Email</span>
              <div className="relative mt-1">
                <Mail className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
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
              disabled={busy || !email}
              className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center">
          Don&apos;t have an account? Access is by invitation only — contact your administrator.
        </p>
      </div>
    </div>
  )
}
