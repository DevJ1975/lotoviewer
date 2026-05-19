'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'

// /admin/people/scim — issue and revoke SCIM 2.0 bearer tokens.
//
// The plaintext token only exists in the API response of POST
// /api/admin/scim-tokens; the DB stores the SHA-256 hex of it.
// Once the admin closes the disclosure dialog, the token is gone for
// good — they have to issue a new one if they lose it.

interface ScimTokenRow {
  id:            string
  name:          string
  created_at:    string
  last_used_at:  string | null
  revoked_at:    string | null
}

async function tenantHeaders(tenantId: string) {
  const { data: { session } } = await supabase.auth.getSession()
  const h = new Headers()
  if (session?.access_token) h.set('Authorization', `Bearer ${session.access_token}`)
  h.set('x-active-tenant', tenantId)
  h.set('Content-Type', 'application/json')
  return h
}

export default function ScimPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [tokens, setTokens]       = useState<ScimTokenRow[] | null>(null)
  const [error, setError]         = useState<string | null>(null)
  const [creating, setCreating]   = useState(false)
  const [newName, setNewName]     = useState('')
  const [issuedToken, setIssuedToken] = useState<{ token: string; name: string } | null>(null)
  const [copied, setCopied]       = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    const { data, error: err } = await supabase
      .from('scim_tokens')
      .select('id, name, created_at, last_used_at, revoked_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
    if (err) {
      setError(formatSupabaseError(err, 'load SCIM tokens'))
      return
    }
    setTokens((data ?? []) as ScimTokenRow[])
  }, [tenantId])

  useEffect(() => { if (!authLoading && profile?.is_admin) void load() }, [authLoading, profile, load])

  async function create() {
    if (!tenantId) return
    if (!newName.trim()) { setError('Token name is required.'); return }
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/scim-tokens', {
        method:  'POST',
        headers: await tenantHeaders(tenantId),
        body:    JSON.stringify({ name: newName.trim() }),
      })
      const json = await res.json()
      if (!res.ok) {
        setError(json?.error ?? `Create failed (${res.status})`)
        return
      }
      setIssuedToken({ token: json.token, name: newName.trim() })
      setNewName('')
      await load()
    } finally {
      setCreating(false)
    }
  }

  async function revoke(t: ScimTokenRow) {
    if (!tenantId) return
    if (!confirm(`Revoke "${t.name}"? Any integration using this token will stop working immediately.`)) return
    setError(null)
    const res = await fetch(`/api/admin/scim-tokens?id=${encodeURIComponent(t.id)}`, {
      method:  'DELETE',
      headers: await tenantHeaders(tenantId),
    })
    if (!res.ok) {
      const json = await res.json().catch(() => null)
      setError(json?.error ?? `Revoke failed (${res.status})`)
      return
    }
    await load()
  }

  async function copyToken() {
    if (!issuedToken) return
    try {
      await navigator.clipboard.writeText(issuedToken.token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Older Safari path — leave the token selected so the user can copy manually.
    }
  }

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile?.is_admin) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-brand-navy" />
          SCIM 2.0 tokens
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Bearer tokens for SCIM 2.0 user provisioning. Use these in the{' '}
          <span className="font-mono">Authorization: Bearer …</span> header on{' '}
          <span className="font-mono">/api/scim/v2/Users</span>. Tokens are hashed at rest
          and shown in plaintext only once — store yours immediately.
        </p>
      </div>

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-5 space-y-3">
        <header>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Issue a new token</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            Pick a name your future self will recognize (e.g. &quot;Okta&quot;, &quot;Azure AD prod&quot;).
          </p>
        </header>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder="Okta production"
            disabled={creating}
            className="flex-1 rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
          />
          <button
            type="button"
            onClick={create}
            disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            {creating ? 'Issuing…' : 'Issue token'}
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">{error}</div>
      )}

      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        <header className="px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Active tokens</h2>
        </header>
        {tokens === null ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" /></div>
        ) : tokens.length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-slate-500 dark:text-slate-400">No tokens yet.</div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {tokens.map(t => {
              const revoked = !!t.revoked_at
              return (
                <li key={t.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {t.name}
                      {revoked && <span className="ml-2 inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">Revoked</span>}
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Issued {new Date(t.created_at).toLocaleString()}
                      {t.last_used_at && <> · last used {new Date(t.last_used_at).toLocaleString()}</>}
                      {revoked && <> · revoked {new Date(t.revoked_at!).toLocaleString()}</>}
                    </p>
                  </div>
                  {!revoked && (
                    <button
                      type="button"
                      onClick={() => revoke(t)}
                      aria-label={`Revoke ${t.name}`}
                      className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 p-1"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {issuedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-xl p-5 space-y-4">
            <header>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Token issued: {issuedToken.name}</h2>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                Copy this token now. Once you close this dialog, it cannot be retrieved.
              </p>
            </header>
            <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950/40 p-3 font-mono text-xs break-all select-all">
              {issuedToken.token}
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={copyToken}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-navy hover:underline"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy token'}
              </button>
              <button
                type="button"
                onClick={() => setIssuedToken(null)}
                className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
              >
                I have saved it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
