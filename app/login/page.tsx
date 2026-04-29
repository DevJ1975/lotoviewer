'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Mail } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import PasswordField from '@/components/PasswordField'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const search = useSearchParams()
  const next   = search.get('next') || '/'
  const { userId, profile, loading, signIn } = useAuth()

  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  // If already signed in, bounce away from /login.
  useEffect(() => {
    if (loading) return
    if (!userId) return
    if (profile?.must_change_password) router.replace('/welcome')
    else router.replace(next)
  }, [loading, userId, profile, next, router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const { error } = await signIn(email.trim(), password)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900/40 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-2xl shadow-sm ring-1 ring-slate-200 dark:ring-slate-700 p-6 space-y-5"
      >
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Soteria <span className="text-brand-navy dark:text-brand-yellow tracking-wider">FIELD</span>
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Sign in to continue</p>
        </div>

        <div className="space-y-3">
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
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Password</span>
            <div className="mt-1">
              <PasswordField
                required
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </label>
        </div>

        {error && (
          <p className="text-sm font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || !email || !password}
          className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="text-xs text-slate-400 dark:text-slate-500 text-center">
          Access is by invitation only. Contact your administrator if you need an account.
        </p>

        <p className="text-[11px] text-slate-400 dark:text-slate-500 text-center pt-2 border-t border-slate-100 dark:border-slate-800">
          <a href="/privacy" className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors">Privacy</a>
          <span aria-hidden="true" className="mx-2">·</span>
          <a href="/terms" className="hover:text-slate-700 dark:hover:text-slate-200 transition-colors">Terms</a>
        </p>
      </form>
    </div>
  )
}
