'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, User as UserIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import PasswordField from '@/components/PasswordField'

export default function WelcomePage() {
  const router = useRouter()
  const { userId, email, profile, loading, refresh, setProfile } = useAuth()

  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [busy, setBusy]         = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (loading) return
    if (!userId) { router.replace('/login'); return }
    // Prefill the name field; this page doubles as a "change password / update
    // name" settings screen once the initial must_change_password flag clears.
    if (profile?.full_name) setFullName(profile.full_name)
  }, [loading, userId, profile, router])

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)

    const trimmedName = fullName.trim()
    if (!trimmedName) { setError('Please enter your full name.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirm) { setError('Passwords do not match.'); return }

    setBusy(true)
    try {
      const { error: pwErr } = await supabase.auth.updateUser({ password })
      if (pwErr) { setError(pwErr.message); return }

      const { data: updated, error: profErr } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          must_change_password: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', userId!)
        .select('*')
        .single()
      if (profErr) { setError(profErr.message); return }

      if (updated) setProfile(updated)
      await refresh()
      router.replace('/')
    } finally {
      setBusy(false)
    }
  }

  if (loading || !userId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-2xl shadow-sm ring-1 ring-slate-200 p-6 space-y-5"
      >
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-slate-900">Welcome</h1>
          <p className="text-sm text-slate-500">
            Finish setting up your account. Signed in as <span className="font-medium text-slate-700">{email}</span>.
          </p>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Full name</span>
            <div className="relative mt-1">
              <UserIcon className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">New password</span>
            <div className="mt-1">
              <PasswordField
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Confirm password</span>
            <div className="mt-1">
              <PasswordField
                required
                minLength={8}
                autoComplete="new-password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
              />
            </div>
          </label>
        </div>

        {error && (
          <p className="text-sm font-medium text-rose-700 bg-rose-50 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full py-2.5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
