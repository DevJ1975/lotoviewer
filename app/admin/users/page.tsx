'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Check, Copy, Loader2, Mail, MailCheck, Shield, Trash2, UserPlus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'

interface AdminUserRow {
  id:                   string
  email:                string
  full_name:            string | null
  is_admin:             boolean
  must_change_password: boolean
  created_at:           string
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}

export default function AdminUsersPage() {
  const { profile, loading: authLoading } = useAuth()
  const [users, setUsers]   = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [email, setEmail]       = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy]         = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [justInvited, setJustInvited] = useState<{ email: string; fullName: string; tempPassword: string; emailSent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchUsers = useCallback(async () => {
    const res = await authFetch('/api/admin/users')
    if (!res.ok) {
      setLoadError((await res.json().catch(() => ({ error: res.statusText }))).error ?? 'Could not load users')
      setLoading(false)
      return
    }
    const data = await res.json() as { users: AdminUserRow[] }
    setUsers(data.users)
    setLoading(false)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!profile?.is_admin) return
    fetchUsers()
  }, [authLoading, profile, fetchUsers])

  async function onInvite(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setInviteError(null)
    try {
      const res = await authFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), fullName: fullName.trim() }),
      })
      const body = await res.json()
      if (!res.ok) { setInviteError(body.error ?? 'Could not create user'); return }
      setJustInvited({
        email:        body.email,
        fullName:     body.fullName ?? '',
        tempPassword: body.tempPassword,
        emailSent:    body.emailSent === true,
      })
      setEmail('')
      setFullName('')
      fetchUsers()
    } finally {
      setBusy(false)
    }
  }

  async function onRemove(id: string, userEmail: string) {
    if (!confirm(`Remove ${userEmail} from the system?`)) return
    const res = await authFetch(`/api/admin/users?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      alert(body.error ?? 'Could not remove user')
      return
    }
    fetchUsers()
  }

  const emailTemplate = useMemo(() => {
    if (!justInvited) return ''
    const displayName = justInvited.fullName || justInvited.email.split('@')[0]
    return `Hi ${displayName},

You've been invited to Soteria Field. Here's how to log in for the first time:

1. Open Soteria Field in your browser.
2. Sign in with:
     Email:     ${justInvited.email}
     Password:  ${justInvited.tempPassword}
3. On your first login you'll be asked to confirm your full name and set a new password of your own. Please use a password at least 8 characters long.

The temporary password above only works until you change it, and you must change it on first login.

If you have any trouble signing in, reply to this email.

— Jamil
jamil@trainovations.com`
  }, [justInvited])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            User Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Invite users and copy the welcome email to send them.</p>
        </div>
      </header>

      {/* Invite form */}
      <section className="bg-white dark:bg-slate-900 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-5">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          Invite a user
        </h2>
        <form onSubmit={onInvite} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Full name (optional)</span>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Email</span>
            <div className="relative mt-1">
              <Mail className="h-4 w-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={busy || !email}
            className="h-[38px] px-5 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors flex items-center justify-center gap-2"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </form>
        {inviteError && (
          <p className="mt-3 text-sm font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{inviteError}</p>
        )}
      </section>

      {/* Result panel for the most recent invite. Two shapes:
          • emailSent=true  — green confirmation, password shown small as
            a fallback in case the email got caught by spam.
          • emailSent=false — full copy-paste template (legacy behavior),
            so the admin can paste into their own email client. */}
      {justInvited && justInvited.emailSent && (
        <section className="bg-emerald-50 dark:bg-emerald-950/40 rounded-xl ring-1 ring-emerald-200 p-5">
          <div className="flex items-start gap-3">
            <MailCheck className="h-6 w-6 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> Invitation emailed to {justInvited.email}
              </h2>
              <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-1">
                {(justInvited.fullName || justInvited.email.split('@')[0])} will receive a sign-in link with their one-time password.
                On first login they'll be required to set their own password (≥ 8 characters).
              </p>
              <details className="mt-3 text-xs text-emerald-900 dark:text-emerald-100">
                <summary className="cursor-pointer font-semibold hover:underline">
                  Show one-time password (in case the email gets lost)
                </summary>
                <div className="mt-2 inline-flex items-center gap-2 bg-white dark:bg-slate-900 rounded-md px-3 py-1.5 ring-1 ring-emerald-200">
                  <code className="text-sm font-mono tracking-wide">{justInvited.tempPassword}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(justInvited.tempPassword)
                        setCopied(true); setTimeout(() => setCopied(false), 1500)
                      } catch { /* ignore */ }
                    }}
                    className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100"
                    aria-label="Copy password"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {copied && <span className="text-[11px] text-emerald-700 dark:text-emerald-300">copied</span>}
                </div>
              </details>
            </div>
          </div>
        </section>
      )}

      {justInvited && !justInvited.emailSent && (
        <section className="bg-amber-50 dark:bg-amber-950/40 rounded-xl ring-1 ring-amber-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-bold text-amber-900 dark:text-amber-100">Invite created — email not sent</h2>
              <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
                The user is created but Resend isn't configured (or the send failed). Copy this into your email to {justInvited.email}.
                The password is shown once; save it if you lose the window.
              </p>
            </div>
            <button
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(emailTemplate)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch { /* ignore */ }
              }}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-amber-300 text-amber-900 dark:text-amber-100 text-xs font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-xs font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 rounded-lg p-3 ring-1 ring-amber-200 max-h-80 overflow-auto">
{emailTemplate}
          </pre>
        </section>
      )}

      {/* User list */}
      <section className="bg-white dark:bg-slate-900 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Users</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{users.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
        ) : loadError ? (
          <p className="px-5 py-6 text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
        ) : users.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500 dark:text-slate-400">No users yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {users.map(u => (
              <li key={u.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{u.full_name || u.email.split('@')[0]}</span>
                    {u.is_admin && <span className="text-[10px] font-bold text-brand-navy dark:text-brand-yellow bg-brand-navy/10 dark:bg-brand-navy/30 rounded-full px-1.5 py-0.5 uppercase tracking-wider">Admin</span>}
                    {u.must_change_password && <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 rounded-full px-1.5 py-0.5">pending first login</span>}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{u.email}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(u.id, u.email)}
                  title="Remove user"
                  aria-label={`Remove ${u.email}`}
                  className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 p-1.5 rounded-md hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
