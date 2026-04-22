'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, Loader2, Mail, Shield, Trash2, UserPlus } from 'lucide-react'
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
  const [justInvited, setJustInvited] = useState<{ email: string; fullName: string; tempPassword: string } | null>(null)
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
      setJustInvited({ email: body.email, fullName: body.fullName ?? '', tempPassword: body.tempPassword })
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

You've been invited to the LOTO Placard System. Here's how to log in for the first time:

1. Open the LOTO app in your browser.
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
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500">Admins only.</div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 hover:text-brand-navy" aria-label="Back to dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-500" />
            User Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">Invite users and copy the welcome email to send them.</p>
        </div>
      </header>

      {/* Invite form */}
      <section className="bg-white rounded-xl ring-1 ring-slate-200 p-5">
        <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-slate-500" />
          Invite a user
        </h2>
        <form onSubmit={onInvite} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Full name (optional)</span>
            <input
              type="text"
              value={fullName}
              onChange={e => setFullName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Email</span>
            <div className="relative mt-1">
              <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="user@example.com"
                className="w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
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
          <p className="mt-3 text-sm font-medium text-rose-700 bg-rose-50 rounded-lg px-3 py-2">{inviteError}</p>
        )}
      </section>

      {/* Copy-paste template for the most recent invite */}
      {justInvited && (
        <section className="bg-emerald-50 rounded-xl ring-1 ring-emerald-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-bold text-emerald-900">Invitation email — ready to send</h2>
              <p className="text-xs text-emerald-700 mt-0.5">
                Copy this into your email to {justInvited.email}. The password is shown once; save it if you lose the window.
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
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-emerald-300 text-emerald-800 text-xs font-semibold hover:bg-emerald-100 transition-colors"
            >
              <Copy className="h-3.5 w-3.5" />
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="whitespace-pre-wrap text-xs font-mono text-slate-800 bg-white rounded-lg p-3 ring-1 ring-emerald-200 max-h-80 overflow-auto">
{emailTemplate}
          </pre>
        </section>
      )}

      {/* User list */}
      <section className="bg-white rounded-xl ring-1 ring-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900">Users</h2>
          <span className="text-xs text-slate-500 tabular-nums">{users.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : loadError ? (
          <p className="px-5 py-6 text-sm text-rose-700">{loadError}</p>
        ) : users.length === 0 ? (
          <p className="px-5 py-6 text-sm text-slate-500">No users yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.map(u => (
              <li key={u.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800 truncate">{u.full_name || u.email.split('@')[0]}</span>
                    {u.is_admin && <span className="text-[10px] font-bold text-brand-navy bg-brand-navy/10 rounded-full px-1.5 py-0.5 uppercase tracking-wider">Admin</span>}
                    {u.must_change_password && <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5">pending first login</span>}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{u.email}</div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(u.id, u.email)}
                  title="Remove user"
                  aria-label={`Remove ${u.email}`}
                  className="text-slate-400 hover:text-rose-600 p-1.5 rounded-md hover:bg-rose-50 transition-colors"
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
