'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, CloudUpload, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { superadminJson } from '@/lib/superadminFetch'

// STRIKE Studio video pipeline, per module version:
//   1. Original file → Supabase strike-media (master archive; the tenant
//      keeps the source even if the streaming provider ever changes).
//   2. Same file → Cloudflare Stream via a one-time direct-upload URL, so
//      the bytes never pass through a Vercel function body limit.
//   3. Poll until Stream finishes transcoding; the server flips the
//      version to provider 'cloudflare' only at that point.
// Legacy storage-only versions get a "Migrate" path that has Stream pull
// the file from a signed archive URL instead of re-uploading.

const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm'])
const POLL_INTERVAL_MS = 5_000
const POLL_LIMIT = 120

type Phase =
  | { name: 'idle' }
  | { name: 'archiving' }
  | { name: 'uploading' }
  | { name: 'processing' }
  | { name: 'done' }
  | { name: 'error'; message: string }

interface StudioVideoUploadProps {
  versionId: string
  libraryScope: 'global' | 'tenant'
  tenantId: string | null
  videoProvider: string | null
  videoReady: boolean
  videoPath: string | null
  onChanged: () => void
}

export function StudioVideoUpload({
  versionId,
  libraryScope,
  tenantId,
  videoProvider,
  videoReady,
  videoPath,
  onChanged,
}: StudioVideoUploadProps) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => () => { cancelledRef.current = true }, [])

  const streaming = videoProvider === 'cloudflare' && videoReady
  const canMigrate = !streaming && !!videoPath
  const busy = phase.name === 'archiving' || phase.name === 'uploading' || phase.name === 'processing'

  async function pollUntilReady() {
    setPhase({ name: 'processing' })
    for (let i = 0; i < POLL_LIMIT && !cancelledRef.current; i++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
      const status = await superadminJson<{ ready: boolean; state: string | null }>(
        `/api/superadmin/strike/upload?module_version_id=${versionId}`,
        { method: 'GET' },
      )
      if (!status.ok) {
        setPhase({ name: 'error', message: status.error ?? 'Status check failed' })
        return
      }
      if (status.body?.ready) {
        setPhase({ name: 'done' })
        onChanged()
        return
      }
    }
    if (!cancelledRef.current) {
      setPhase({ name: 'error', message: 'Still processing — refresh later to check.' })
    }
  }

  async function uploadFile(file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
    if (!VIDEO_EXTENSIONS.has(extension)) {
      setPhase({ name: 'error', message: 'Use an mp4, m4v, mov, or webm file.' })
      return
    }
    const root = libraryScope === 'global' ? 'global' : tenantId
    if (!root) {
      setPhase({ name: 'error', message: 'Tenant module is missing its tenant id.' })
      return
    }

    setPhase({ name: 'archiving' })
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[^a-zA-Z0-9]+/, '') || `video.${extension}`
    const archivePath = `${root}/strike/${versionId}/${safeName}`
    const { error: storageErr } = await supabase.storage
      .from('strike-media')
      .upload(archivePath, file, { upsert: true })
    if (storageErr) {
      setPhase({ name: 'error', message: `Archive upload failed: ${storageErr.message}` })
      return
    }

    const registration = await superadminJson<{ upload_url: string; uid: string }>(
      '/api/superadmin/strike/upload',
      { method: 'POST', body: JSON.stringify({ module_version_id: versionId, archive_path: archivePath }) },
    )
    if (!registration.ok || !registration.body) {
      setPhase({ name: 'error', message: registration.error ?? 'Could not register the upload' })
      return
    }

    setPhase({ name: 'uploading' })
    const form = new FormData()
    form.append('file', file)
    const streamRes = await fetch(registration.body.upload_url, { method: 'POST', body: form })
    if (!streamRes.ok) {
      setPhase({ name: 'error', message: `Stream upload failed (${streamRes.status})` })
      return
    }

    await pollUntilReady()
  }

  async function migrate() {
    setPhase({ name: 'processing' })
    const result = await superadminJson<{ uid: string }>(
      '/api/superadmin/strike/migrate-video',
      { method: 'POST', body: JSON.stringify({ module_version_id: versionId }) },
    )
    if (!result.ok) {
      setPhase({ name: 'error', message: result.error ?? 'Migration failed to start' })
      return
    }
    await pollUntilReady()
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      {streaming ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
          <CheckCircle2 className="h-3 w-3" />
          Streaming
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          {videoPath ? 'Storage video' : 'No video'}
        </span>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/x-m4v,video/quicktime,video/webm"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void uploadFile(file)
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudUpload className="h-3 w-3" />}
        {streaming ? 'Replace video' : 'Upload video'}
      </button>
      {canMigrate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void migrate()}
          className="rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
        >
          Migrate to Stream
        </button>
      )}

      {phase.name === 'archiving' && <span className="text-slate-500">Archiving original…</span>}
      {phase.name === 'uploading' && <span className="text-slate-500">Uploading to Stream…</span>}
      {phase.name === 'processing' && <span className="text-slate-500">Processing…</span>}
      {phase.name === 'done' && <span className="text-emerald-700 dark:text-emerald-300">Ready to stream.</span>}
      {phase.name === 'error' && <span className="text-rose-700 dark:text-rose-300">{phase.message}</span>}
    </div>
  )
}
