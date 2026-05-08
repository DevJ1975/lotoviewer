'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Trash2, Upload } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { compressImage, heicToJpeg, isHeic } from '@/lib/imageUtils'
import { Avatar } from '@/components/ui/Avatar'

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
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]     = useState(false)
  const [error, setError]   = useState<string | null>(null)
  const [okMsg, setOkMsg]   = useState<string | null>(null)

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

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
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

  const display = profile.full_name || profile.email

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
      <div>
        <Link
          href="/welcome"
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">Profile picture</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Shown next to your name in the header, on action items you own,
          and in chat / safety board posts.
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
    </div>
  )
}
