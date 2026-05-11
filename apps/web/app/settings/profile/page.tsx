'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bell, BriefcaseBusiness, CheckCircle2, Loader2, Lock, Save, Trash2, Upload, UserRoundCog } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { compressImage, heicToJpeg, isHeic } from '@/lib/imageUtils'
import { Avatar } from '@/components/ui/Avatar'
import { getMyMemberProfile, updateMyMemberProfile } from '@/lib/members/client'
import type { MemberSummary } from '@/lib/members/types'

// Profile settings: upload, replace, or remove the user's avatar. The
// uploaded image is shown everywhere a user appears (header, action
// items, chat, boards) via the shared <Avatar> component.
//
// Pipeline:
//   1. User picks a file (any common image format, including iOS HEIC)
//   2. heicToJpeg() converts HEIC → JPEG locally (Safari only)
//   3. compressImage() resizes + re-encodes as JPEG ≤ 1MB
//   4. POST to /api/users/me/avatar (multipart) with the JPEG blob
//   5. Server validates + writes to profile-pictures storage bucket and
//      updates profiles.avatar_url with a cache-busted public URL
//
// The route returns the updated profile row which we push into AuthProvider
// so the header avatar updates without a refresh.

const ACCEPT = 'image/png,image/jpeg,image/webp,image/heic,image/heif'

export default function ProfileSettingsPage() {
  const { profile, loading: authLoading, setProfile } = useAuth()
  const { tenant, tenantId } = useTenant()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [okMsg, setOkMsg]   = useState<string | null>(null)
  const [member, setMember] = useState<MemberSummary | null>(null)
  const [memberLoading, setMemberLoading] = useState(true)
  const [memberForm, setMemberForm] = useState({
    preferred_name: '',
    pronouns: '',
    phone: '',
    language: '',
    emergency_contact_name: '',
    emergency_contact_phone: '',
    notify_mentions: true,
    notify_dms: true,
    notify_readiness: true,
    digest_frequency: 'daily',
  })

  const loadMember = useCallback(async () => {
    if (!tenantId || !profile) {
      setMemberLoading(false)
      return
    }
    setMemberLoading(true)
    try {
      const next = await getMyMemberProfile(tenantId)
      setMember(next)
      setMemberForm({
        preferred_name: next?.preferred_name ?? '',
        pronouns: next?.pronouns ?? '',
        phone: next?.phone ?? '',
        language: next?.language ?? '',
        emergency_contact_name: next?.emergency_contact_name ?? '',
        emergency_contact_phone: next?.emergency_contact_phone ?? '',
        notify_mentions: readBooleanPref(next?.notification_preferences, 'mentions', true),
        notify_dms: readBooleanPref(next?.notification_preferences, 'dms', true),
        notify_readiness: readBooleanPref(next?.notification_preferences, 'readiness', true),
        digest_frequency: readStringPref(next?.notification_preferences, 'digest_frequency', 'daily'),
      })
    } catch (err) {
      console.warn('[profile] member profile unavailable', err)
      setMember(null)
    } finally {
      setMemberLoading(false)
    }
  }, [tenantId, profile])

  useEffect(() => { void loadMember() }, [loadMember])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!profile) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Sign in to manage your profile.</div>
  }

  async function authHeader(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    return token ? { Authorization: `Bearer ${token}` } : {}
  }

  async function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    setError(null); setOkMsg(null)
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true)
    try {
      // iOS HEIC → JPEG conversion (Safari only). On Chrome/FF this
      // throws, in which case we surface a friendly error pointing the
      // user at iOS Camera → Formats settings.
      let prepared = file
      if (isHeic(file)) {
        try { prepared = await heicToJpeg(file) }
        catch {
          throw new Error('HEIC images are only supported in Safari. Pick a JPEG/PNG or change iOS Camera → Formats to Most Compatible.')
        }
      }
      // Resize + re-encode to JPEG ≤ 1MB (matches the route's MAX_BYTES).
      const compressed = await compressImage(prepared, 1_000_000)

      const form = new FormData()
      form.set('file', compressed)

      const res = await fetch('/api/users/me/avatar', {
        method:  'POST',
        headers: await authHeader(),
        body:    form,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Upload failed (${res.status})`)

      // Push the fresh profile row into AuthProvider so the header
      // avatar updates immediately.
      if (json.profile) setProfile(json.profile)
      setOkMsg('Profile picture updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function onRemove() {
    setError(null); setOkMsg(null); setBusy(true)
    try {
      const res = await fetch('/api/users/me/avatar', {
        method:  'DELETE',
        headers: await authHeader(),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? `Remove failed (${res.status})`)
      if (json.profile) setProfile(json.profile)
      setOkMsg('Profile picture removed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  async function onSaveMember(e: FormEvent) {
    e.preventDefault()
    if (!tenantId) return
    setError(null); setOkMsg(null); setBusy(true)
    try {
      const updated = await updateMyMemberProfile(tenantId, {
        preferred_name: memberForm.preferred_name.trim() || null,
        pronouns: memberForm.pronouns.trim() || null,
        phone: memberForm.phone.trim() || null,
        language: memberForm.language.trim() || null,
        emergency_contact_name: memberForm.emergency_contact_name.trim() || null,
        emergency_contact_phone: memberForm.emergency_contact_phone.trim() || null,
        notification_preferences: {
          mentions: memberForm.notify_mentions,
          dms: memberForm.notify_dms,
          readiness: memberForm.notify_readiness,
          digest_frequency: memberForm.digest_frequency,
        },
      })
      setMember(updated)
      setOkMsg('Member profile updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update member profile')
    } finally {
      setBusy(false)
    }
  }

  const display = member?.display_name || profile.full_name || profile.email

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">My Profile</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Your tenant profile feeds readiness, chat, safety boards, assignments, and notifications.
        </p>
      </div>

      <div className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 p-6 flex flex-col sm:flex-row items-center sm:items-start gap-6">
        <Avatar
          src={profile.avatar_url}
          name={profile.full_name}
          email={profile.email}
          size="xl"
        />
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{display}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400 truncate">{profile.email}</div>
          <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <IdentityPill label="Tenant" value={tenant?.name ?? 'Active tenant'} />
            <IdentityPill label="Readiness" value={member?.readiness_status?.replaceAll('_', ' ') ?? 'Setting up'} />
            <IdentityPill label="Handle" value={member ? `@${member.handle}` : 'Setting up'} />
            <IdentityPill label="Member code" value={member ? `#${member.member_code}` : 'Setting up'} />
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center sm:justify-start gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {profile.avatar_url ? 'Replace photo' : 'Upload photo'}
            </button>
            {profile.avatar_url && (
              <button
                type="button"
                disabled={busy}
                onClick={onRemove}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> Remove
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept={ACCEPT}
              onChange={onFileChange}
              className="hidden"
            />
          </div>

          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            PNG, JPEG, WebP, or HEIC (Safari). Compressed to 1 MB max.
          </p>

          {error && (
            <p className="mt-3 text-sm font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          {okMsg && (
            <p className="mt-3 text-sm font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 rounded-lg px-3 py-2">
              {okMsg}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={onSaveMember} className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 p-6 space-y-5">
        <header className="flex items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-950 dark:text-slate-50">
              <UserRoundCog className="h-5 w-5 text-brand-navy dark:text-brand-yellow" />
              Demographics and contact
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              You can edit this information. Work assignment and readiness fields stay managed by your administrator.
            </p>
          </div>
          {memberLoading && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
        </header>

        {member ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Preferred name" value={memberForm.preferred_name} onChange={v => setMemberForm(f => ({ ...f, preferred_name: v }))} />
              <Field label="Pronouns" value={memberForm.pronouns} onChange={v => setMemberForm(f => ({ ...f, pronouns: v }))} />
              <Field label="Phone" value={memberForm.phone} onChange={v => setMemberForm(f => ({ ...f, phone: v }))} />
              <Field label="Language" value={memberForm.language} onChange={v => setMemberForm(f => ({ ...f, language: v }))} />
              <Field label="Emergency contact" value={memberForm.emergency_contact_name} onChange={v => setMemberForm(f => ({ ...f, emergency_contact_name: v }))} />
              <Field label="Emergency phone" value={memberForm.emergency_contact_phone} onChange={v => setMemberForm(f => ({ ...f, emergency_contact_phone: v }))} />
            </div>

            <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
              <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
                You can edit this
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                Preferred name, pronouns, phone, language, emergency contact, photo, and notification preferences.
              </p>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                <Bell className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
                Notification preferences
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Toggle label="Mentions" checked={memberForm.notify_mentions} onChange={v => setMemberForm(f => ({ ...f, notify_mentions: v }))} />
                <Toggle label="Direct messages" checked={memberForm.notify_dms} onChange={v => setMemberForm(f => ({ ...f, notify_dms: v }))} />
                <Toggle label="Readiness alerts" checked={memberForm.notify_readiness} onChange={v => setMemberForm(f => ({ ...f, notify_readiness: v }))} />
              </div>
              <label className="mt-3 block space-y-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span>Digest frequency</span>
                <select
                  value={memberForm.digest_frequency}
                  onChange={e => setMemberForm(f => ({ ...f, digest_frequency: e.target.value }))}
                  className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-800"
                >
                  <option value="off">Off</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </label>
            </section>

            <section className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40">
              <h3 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-slate-100">
                <Lock className="h-4 w-4 text-slate-400" />
                Managed by your administrator
              </h3>
              <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <Locked label="Legal name" value={member.legal_name ?? 'Not set'} />
                <Locked label="Handle" value={`@${member.handle}`} />
                <Locked label="Member code" value={`#${member.member_code}`} />
                <Locked label="Employment type" value={member.employment_type} />
                <Locked label="Employee ID" value={member.employee_id ?? 'Not set'} />
                <Locked label="Badge ID" value={member.badge_id ?? 'Not set'} />
                <Locked label="Department" value={member.department ?? 'Not set'} />
                <Locked label="Site" value={member.site_label ?? 'Not set'} />
                <Locked label="Position" value={member.position_title ?? 'Not set'} />
                <Locked label="Shift" value={member.shift_label ?? 'Not set'} />
                <Locked label="Supervisor" value={member.supervisor_name ?? 'Not set'} />
                <Locked label="Readiness" value={member.readiness_status.replaceAll('_', ' ')} />
                <Locked label="Status" value={member.status} />
              </div>
            </section>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-brand-navy px-4 py-2 text-sm font-black text-white hover:bg-brand-navy/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save profile
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
            Your profile is still being set up for this tenant. Ask your supervisor or site administrator to open Member Management and refresh your roster.
          </div>
        )}
      </form>
    </div>
  )
}

function IdentityPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left dark:border-slate-800 dark:bg-slate-950/40">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 truncate font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
      <span>{label}</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal outline-none focus:border-brand-navy focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-800"
      />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy"
      />
      <span className="truncate">{label}</span>
    </label>
  )
}

function readBooleanPref(prefs: Record<string, unknown> | null | undefined, key: string, fallback: boolean): boolean {
  const value = prefs?.[key]
  return typeof value === 'boolean' ? value : fallback
}

function readStringPref(prefs: Record<string, unknown> | null | undefined, key: string, fallback: string): string {
  const value = prefs?.[key]
  return typeof value === 'string' ? value : fallback
}

function Locked({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900">
      <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <BriefcaseBusiness className="h-3 w-3" />
        {label}
      </p>
      <p className="mt-1 truncate font-semibold text-slate-900 dark:text-slate-100">{value}</p>
    </div>
  )
}
