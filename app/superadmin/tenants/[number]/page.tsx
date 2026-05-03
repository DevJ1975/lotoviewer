'use client'

import Image from 'next/image'
import Link from 'next/link'
import { use, useEffect, useMemo, useState, type FormEvent, type ChangeEvent } from 'react'
import { ArrowLeft, Loader2, AlertCircle, CheckCircle2, Upload, Trash2, UserPlus, X, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { getModules, type FeatureCategory, type FeatureDef } from '@/lib/features'
import type { Tenant, TenantRole, TenantStatus } from '@/lib/types'

// Tenant edit page. PATCH /api/superadmin/tenants/[number] handles
// name/status/is_demo/modules; logo upload goes to a separate route
// because it needs multipart/form-data.

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  safety:  'Safety',
  reports: 'Reports',
  admin:   'Admin',
}
const CATEGORY_ORDER: FeatureCategory[] = ['safety', 'reports', 'admin']
const STATUSES: TenantStatus[] = ['active', 'trial', 'disabled', 'archived']

interface MemberRow {
  user_id:    string
  role:       TenantRole
  created_at: string
  email:      string | null
  full_name:  string | null
}

export default function SuperadminTenantDetail({
  params,
}: { params: Promise<{ number: string }> }) {
  const { number } = use(params)
  const { refresh: refreshActiveTenant } = useTenant()

  const [tenant,  setTenant]  = useState<Tenant | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Form state mirrors tenant; changes are local until Save.
  const [name,     setName]    = useState('')
  const [status,   setStatus]  = useState<TenantStatus>('active')
  const [isDemo,   setIsDemo]  = useState(false)
  const [modules,  setModules] = useState<Record<string, boolean>>({})
  const [saving,   setSaving]  = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError,     setLogoError]     = useState<string | null>(null)

  const moduleGroups = useMemo(
    () => CATEGORY_ORDER.map(cat => ({
      category: cat,
      label:    CATEGORY_LABELS[cat],
      modules:  getModules(cat).filter(m => !m.comingSoon),
    })).filter(g => g.modules.length > 0),
    [],
  )

  useEffect(() => { void load() /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [number])

  async function load() {
    setLoading(true); setLoadError(null)
    const { data: tRow, error: tErr } = await supabase
      .from('tenants')
      .select('*')
      .eq('tenant_number', number)
      .maybeSingle()
    if (tErr || !tRow) {
      setLoadError(tErr?.message ?? `No tenant with number ${number}`)
      setLoading(false)
      return
    }
    const t = tRow as Tenant
    setTenant(t)
    setName(t.name)
    setStatus(t.status)
    setIsDemo(t.is_demo)
    setModules({ ...t.modules })

    // Members: join tenant_memberships → profiles via user_id. RLS allows
    // superadmin to read both tables.
    const { data: mRows } = await supabase
      .from('tenant_memberships')
      .select('user_id, role, created_at, profiles:user_id(email, full_name)')
      .eq('tenant_id', t.id)
      .order('created_at', { ascending: true })
    type RawMember = {
      user_id: string; role: TenantRole; created_at: string
      profiles: { email: string | null; full_name: string | null } | null
    }
    setMembers((mRows ?? []).map((r: RawMember) => ({
      user_id:    r.user_id,
      role:       r.role,
      created_at: r.created_at,
      email:      r.profiles?.email     ?? null,
      full_name:  r.profiles?.full_name ?? null,
    })))

    setLoading(false)
  }

  function toggleModule(id: string) {
    setModules(prev => ({ ...prev, [id]: !prev[id] }))
    setSaveSuccess(false)
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!tenant) return
    setSaving(true); setSaveError(null); setSaveSuccess(false)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setSaveError('Not signed in'); setSaving(false); return }

      const res = await fetch(`/api/superadmin/tenants/${number}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          name:    name.trim(),
          status,
          is_demo: isDemo,
          modules,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setSaveError(json?.error ?? `Save failed (${res.status})`)
        setSaving(false)
        return
      }
      setTenant(json.tenant as Tenant)
      setSaveSuccess(true)
      // If the edited tenant is one the current user belongs to, re-fetch
      // so the header pill / drawer reflect new name + modules immediately.
      void refreshActiveTenant()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function onLogoUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !tenant) return
    setLogoUploading(true); setLogoError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setLogoError('Not signed in'); setLogoUploading(false); return }

      const fd = new FormData()
      fd.append('file', file)

      const res = await fetch(`/api/superadmin/tenants/${number}/logo`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    fd,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLogoError(json?.error ?? `Upload failed (${res.status})`)
        return
      }
      setTenant(json.tenant as Tenant)
      void refreshActiveTenant()
    } catch (err: unknown) {
      setLogoError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLogoUploading(false)
      // Allow re-uploading the same file (input doesn't re-fire change otherwise).
      e.target.value = ''
    }
  }

  async function onLogoClear() {
    if (!tenant) return
    if (!confirm('Remove the logo? The image stays in storage but the tenant header reverts to initials.')) return
    setLogoUploading(true); setLogoError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setLogoError('Not signed in'); setLogoUploading(false); return }

      const res = await fetch(`/api/superadmin/tenants/${number}/logo`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setLogoError(json?.error ?? `Clear failed (${res.status})`)
        return
      }
      setTenant(json.tenant as Tenant)
      void refreshActiveTenant()
    } catch (err: unknown) {
      setLogoError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLogoUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (loadError || !tenant) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/superadmin/tenants" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> All tenants
        </Link>
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{loadError ?? 'Not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link href="/superadmin/tenants" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> All tenants
      </Link>

      <header className="mb-8">
        <p className="font-mono text-sm text-slate-500 dark:text-slate-400">#{tenant.tenant_number}</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
          {tenant.name}
          {tenant.is_demo && (
            <span className="ml-3 align-middle inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">Demo</span>
          )}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">{tenant.slug}</p>
      </header>

      {/* ── Logo section ────────────────────────────────────────────────── */}
      <Section title="Logo">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden">
            {tenant.logo_url ? (
              <Image src={tenant.logo_url} alt={`${tenant.name} logo`} width={80} height={80} className="object-contain" unoptimized />
            ) : (
              <span className="text-xs text-slate-400 dark:text-slate-500">No logo</span>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <label className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 cursor-pointer transition-colors">
              {logoUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {tenant.logo_url ? 'Replace' : 'Upload'} logo
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogoUpload} disabled={logoUploading} />
            </label>
            {tenant.logo_url && (
              <button
                type="button"
                onClick={onLogoClear}
                disabled={logoUploading}
                className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
          PNG, JPEG, or WebP. Max 1MB. Shown in the app header next to the tenant name.
        </p>
        {logoError && (
          <p className="mt-2 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
            <AlertCircle className="h-3.5 w-3.5" /> {logoError}
          </p>
        )}
      </Section>

      {/* ── Edit form ───────────────────────────────────────────────────── */}
      <form onSubmit={onSave} className="mt-8 space-y-6" noValidate>
        <Section title="Basic info">
          <div className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Name</label>
              <input
                id="name"
                type="text"
                required
                maxLength={200}
                value={name}
                onChange={e => { setName(e.target.value); setSaveSuccess(false) }}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
              />
            </div>

            <div>
              <label htmlFor="status" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Status</label>
              <select
                id="status"
                value={status}
                onChange={e => { setStatus(e.target.value as TenantStatus); setSaveSuccess(false) }}
                className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
              >
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Setting <span className="font-mono">disabled</span> hides the tenant&apos;s data from all users (RLS) but preserves it for audit.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <input
                id="is_demo"
                type="checkbox"
                checked={isDemo}
                onChange={e => { setIsDemo(e.target.checked); setSaveSuccess(false) }}
                className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
              />
              <label htmlFor="is_demo" className="text-sm text-slate-700 dark:text-slate-200">
                <span className="font-medium">Demo tenant</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">Eligible for &quot;Reset Demo&quot; (slice 6.4).</span>
              </label>
            </div>
          </div>
        </Section>

        <Section title="Modules">
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            Top-level modules. Children inherit their parent&apos;s setting.
          </p>
          <div className="space-y-5">
            {moduleGroups.map(g => (
              <div key={g.category}>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{g.label}</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {g.modules.map(m => (
                    <ModuleCheckbox
                      key={m.id}
                      module={m}
                      checked={modules[m.id] === true}
                      onToggle={() => toggleModule(m.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {saveError && (
          <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
            <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
            <p className="text-sm text-rose-800 dark:text-rose-200">{saveError}</p>
          </div>
        )}

        {saveSuccess && (
          <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex gap-2 items-center">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm text-emerald-800 dark:text-emerald-200">Saved.</p>
          </div>
        )}

        <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>

      {/* ── Members ─────────────────────────────────────────────────────── */}
      <div className="mt-10">
        <MembersSection tenantNumber={number} members={members} reload={load} />
      </div>

      {/* ── Reset demo (only for is_demo tenants) ──────────────────────── */}
      {tenant.is_demo && (
        <div className="mt-10">
          <ResetDemoSection tenantNumber={number} tenantName={tenant.name} reload={load} />
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-5">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function ModuleCheckbox({
  module: m, checked, onToggle,
}: { module: FeatureDef; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-2 p-2 rounded-md border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{m.name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{m.description}</div>
      </div>
    </label>
  )
}

// ─── Members ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS: TenantRole[] = ['owner', 'admin', 'member', 'viewer']

interface InviteResult {
  email:          string
  role:           TenantRole
  tempPassword?:  string
  alreadyExisted: boolean
}

function MembersSection({
  tenantNumber, members, reload,
}: { tenantNumber: string; members: MemberRow[]; reload: () => Promise<void> }) {
  const [inviteOpen,   setInviteOpen]   = useState(false)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteName,   setInviteName]   = useState('')
  const [inviteRole,   setInviteRole]   = useState<TenantRole>('member')
  const [inviteBusy,   setInviteBusy]   = useState(false)
  const [inviteError,  setInviteError]  = useState<string | null>(null)
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)

  // Per-row mutation state. Keyed by user_id.
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [rowError,   setRowError]   = useState<string | null>(null)

  async function bearerToken(): Promise<string | null> {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token ?? null
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    setInviteError(null); setInviteResult(null)
    const email = inviteEmail.trim().toLowerCase()
    if (!email) { setInviteError('Email required'); return }

    setInviteBusy(true)
    try {
      const token = await bearerToken()
      if (!token) { setInviteError('Not signed in'); return }

      const res = await fetch(`/api/superadmin/tenants/${tenantNumber}/members`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          email,
          role:      inviteRole,
          full_name: inviteName.trim() || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteError(json?.error ?? `Invite failed (${res.status})`)
        return
      }
      setInviteResult({
        email:          json.email,
        role:           json.role,
        tempPassword:   json.tempPassword,
        alreadyExisted: json.alreadyExisted,
      })
      setInviteEmail(''); setInviteName(''); setInviteRole('member')
      await reload()
    } catch (err: unknown) {
      setInviteError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setInviteBusy(false)
    }
  }

  async function changeRole(userId: string, role: TenantRole) {
    setBusyUserId(userId); setRowError(null)
    try {
      const token = await bearerToken()
      if (!token) { setRowError('Not signed in'); return }
      const res = await fetch(`/api/superadmin/tenants/${tenantNumber}/members/${userId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ role }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setRowError(json?.error ?? `Change failed (${res.status})`); return }
      await reload()
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusyUserId(null)
    }
  }

  async function removeMember(userId: string, label: string) {
    if (!confirm(`Remove ${label} from this tenant? Their account stays — only the membership is removed.`)) return
    setBusyUserId(userId); setRowError(null)
    try {
      const token = await bearerToken()
      if (!token) { setRowError('Not signed in'); return }
      const res = await fetch(`/api/superadmin/tenants/${tenantNumber}/members/${userId}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setRowError(json?.error ?? `Remove failed (${res.status})`); return }
      await reload()
    } catch (err: unknown) {
      setRowError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <Section title={`Members (${members.length})`}>
      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={() => { setInviteOpen(o => !o); setInviteError(null); setInviteResult(null) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-brand-navy text-white hover:bg-brand-navy/90 transition-colors"
        >
          {inviteOpen ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {inviteOpen ? 'Cancel' : 'Invite member'}
        </button>
      </div>

      {inviteOpen && (
        <form onSubmit={onInvite} className="mb-4 p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="email"
              required
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            />
            <input
              type="text"
              placeholder="Full name (optional)"
              value={inviteName}
              onChange={e => setInviteName(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as TenantRole)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            >
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={inviteBusy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 transition-colors"
            >
              {inviteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {inviteBusy ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
          {inviteError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {inviteError}
            </p>
          )}
        </form>
      )}

      {inviteResult && (
        <div className="mb-4 p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-emerald-900 dark:text-emerald-100">
                {inviteResult.alreadyExisted ? 'Added existing user' : 'Invite created'}: {inviteResult.email} ({inviteResult.role})
              </p>
              {inviteResult.tempPassword && (
                <p className="mt-2 text-emerald-800 dark:text-emerald-200 text-xs">
                  Temporary password (share with the user — they&apos;ll be forced to rotate it on first login):
                  <code className="block mt-1 p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded font-mono text-sm select-all">
                    {inviteResult.tempPassword}
                  </code>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {rowError && (
        <div className="mb-3 p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {rowError}
        </div>
      )}

      {members.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No members yet. Use the invite button above.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {members.map(m => {
            const label = m.full_name ?? m.email ?? m.user_id
            const busy  = busyUserId === m.user_id
            return (
              <li key={m.user_id} className="py-2 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{label}</p>
                  {m.email && m.full_name && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">{m.email}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={m.role}
                    onChange={e => changeRole(m.user_id, e.target.value as TenantRole)}
                    disabled={busy}
                    className="px-2 py-1 text-xs uppercase tracking-wider font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-navy disabled:opacity-60"
                  >
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeMember(m.user_id, label)}
                    disabled={busy}
                    aria-label={`Remove ${label}`}
                    className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

// ─── Reset Demo ─────────────────────────────────────────────────────────────

function ResetDemoSection({
  tenantNumber, tenantName, reload,
}: { tenantNumber: string; tenantName: string; reload: () => Promise<void> }) {
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)
  const [result, setResult] = useState<{ wiped: Record<string, number>; skipped: string[] } | null>(null)

  async function onReset() {
    const phrase = `RESET ${tenantNumber}`
    const got = prompt(
      `This wipes ALL domain data for ${tenantName} (#${tenantNumber}) — equipment, permits, training records, audit log.\n\n` +
      `Re-seeding canonical demo data is wired in Phase D; for now the tenant ends up empty.\n\n` +
      `Type "${phrase}" to confirm.`,
    )
    if (got !== phrase) {
      if (got !== null) alert('Confirmation phrase did not match. Nothing was changed.')
      return
    }

    setBusy(true); setError(null); setResult(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setError('Not signed in'); return }

      const res = await fetch(`/api/superadmin/tenants/${tenantNumber}/reset-demo`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(json?.error ?? `Reset failed (${res.status})`); return }
      setResult({ wiped: json.wiped ?? {}, skipped: json.skipped ?? [] })
      await reload()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setBusy(false)
    }
  }

  const totalWiped = result ? Object.values(result.wiped).reduce((a, b) => a + b, 0) : 0

  return (
    <Section title="Reset demo data">
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-4">
        Wipes every domain row in this tenant. The tenant row, memberships, and
        settings are preserved. Re-seeding canonical demo data ships in Phase&nbsp;D.
      </p>

      <button
        type="button"
        onClick={onReset}
        disabled={busy}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-md bg-rose-600 text-white text-sm font-medium hover:bg-rose-700 disabled:opacity-60 transition-colors"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        {busy ? 'Wiping…' : 'Reset demo data'}
      </button>

      {error && (
        <p className="mt-3 text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </p>
      )}

      {result && (
        <div className="mt-4 p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-sm">
          <p className="font-medium text-emerald-900 dark:text-emerald-100 mb-2">
            Wiped {totalWiped.toLocaleString()} row{totalWiped === 1 ? '' : 's'}.
          </p>
          <ul className="text-xs text-emerald-800 dark:text-emerald-200 grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono">
            {Object.entries(result.wiped)
              .filter(([, n]) => n > 0)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([t, n]) => <li key={t}>{t}: {n}</li>)}
          </ul>
          {result.skipped.length > 0 && (
            <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300/70">
              Skipped (table not in this DB): {result.skipped.join(', ')}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}
