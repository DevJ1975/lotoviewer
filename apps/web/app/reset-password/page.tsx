'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, AlertCircle, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import PasswordField from '@/components/PasswordField'

// /reset-password — landing page for the email link Supabase sends
// when a user requests a password reset.
//
// HOW IT WORKS:
// Supabase encodes a recovery token in the URL hash (e.g.
// `#access_token=...&type=recovery`) and redirects here. The Supabase
// JS client picks up the hash automatically and creates a temporary
// session for the user. While that session is active, calling
// auth.updateUser({ password }) sets a new password.
//
// We don't read the hash ourselves — we just listen to onAuthStateChange
// for the PASSWORD_RECOVERY event (or look for an existing session)
// and let Supabase handle the token-to-session exchange.

const MIN_PASSWORD_LENGTH = 8

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>}>
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordForm() {
  const router = useRouter()
  const [tokenStatus, setTokenStatus] = useState<'checking' | 'valid' | 'invalid'>('checking')
  const [password,    setPassword]    = useState('')
  const [confirm,     setConfirm]     = useState('')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [done,        setDone]        = useState(false)

  // On mount: check if Supabase has already exchanged the URL hash for
  // a session, OR wait briefly for a PASSWORD_RECOVERY event.
  useEffect(() => {
    let cancelled = false

    async function check() {
      const { data: { session } } = await supabase.auth.getSession()
      if (cancelled) return
      if (session) { setTokenStatus('valid'); return }
      // No session yet — wait for Supabase to process the hash.
      // Onauthstatechange fires within ~100ms in practice. If 3s pass
      // with no event, the link is bad/expired.
      const timeout = setTimeout(() => { if (!cancelled) setTokenStatus('invalid') }, 3000)
      const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
        if (cancelled) return
        if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && sess) {
          clearTimeout(timeout)
          setTokenStatus('valid')
        }
      })
      return () => { sub.subscription.unsubscribe(); clearTimeout(timeout) }
    }
    void check()
    return () => { cancelled = true }
  }, [])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`); return
    }
    if (password !== confirm) {
      setError('Passwords don\'t match.'); return
    }
    setBusy(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    // Also clear must_change_password since we just rotated it.
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      await supabase.from('profiles').update({ must_change_password: false }).eq('id', user.id)
    }
    setDone(true)
    setTimeout(() => router.replace('/'), 2000)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 px-4">
      <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 p-6 space-y-5">
        <Link href="/login" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors">
          <ArrowLeft className="h-3 w-3" /> Back to sign in
        </Link>

        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Set a new password</h1>
        </div>

        {tokenStatus === 'checking' && (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-500 dark:text-slate-400 py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your reset link…
          </div>
        )}

        {tokenStatus === 'invalid' && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <div className="text-sm text-rose-800 dark:text-rose-200">
              <p className="font-medium">This link is invalid or expired.</p>
              <p className="text-xs mt-1 opacity-90">
                Reset links are good for one hour and one use.
                {' '}
                <Link href="/forgot-password" className="text-brand-navy dark:text-brand-yellow hover:underline">
                  Request a new one
                </Link>.
              </p>
            </div>
          </div>
        )}

        {tokenStatus === 'valid' && !done && (
          <form onSubmit={onSubmit} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">New password</span>
              <div className="mt-1">
                <PasswordField
                  required
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
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
              disabled={busy || !password || !confirm}
              className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? 'Updating…' : 'Set new password'}
            </button>
          </form>
        )}

        {done && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-sm text-emerald-800 dark:text-emerald-200">
              <p className="font-medium">Password updated.</p>
              <p className="text-xs mt-1 opacity-90">Redirecting to your dashboard…</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
