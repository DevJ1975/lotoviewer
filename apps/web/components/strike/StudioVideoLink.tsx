'use client'

import { useState } from 'react'
import { CheckCircle2, Link2, Loader2, Trash2, Video } from 'lucide-react'
import { parseVimeoReference } from '@soteria/core/strikeMedia'
import { superadminJson } from '@/lib/superadminFetch'

// STRIKE videos are Vimeo links. The superadmin pastes a vimeo.com URL (public,
// or unlisted with its privacy hash); we validate it exactly as the server
// will, store the id + hash on the version, and the learner player embeds it.
// No upload, no transcode, no storage bucket.

interface StudioVideoLinkProps {
  versionId: string
  videoExternalId: string | null
  vimeoHash: string | null
  onChanged: () => void
}

type Status =
  | { name: 'idle' }
  | { name: 'saving' }
  | { name: 'removing' }
  | { name: 'error'; message: string }

export function StudioVideoLink({ versionId, videoExternalId, vimeoHash, onChanged }: StudioVideoLinkProps) {
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<Status>({ name: 'idle' })

  const hasVideo = !!videoExternalId
  const busy = status.name === 'saving' || status.name === 'removing'
  const parsed = url.trim() ? parseVimeoReference(url) : null
  const inputInvalid = url.trim().length > 0 && !parsed

  const currentLink = videoExternalId
    ? `https://vimeo.com/${videoExternalId}${vimeoHash ? `/${vimeoHash}` : ''}`
    : null

  async function save() {
    if (!parsed) {
      setStatus({ name: 'error', message: 'Enter a valid Vimeo link or id.' })
      return
    }
    setStatus({ name: 'saving' })
    const result = await superadminJson(
      '/api/superadmin/strike/video',
      { method: 'POST', body: JSON.stringify({ module_version_id: versionId, vimeo_url: url.trim() }) },
    )
    if (!result.ok) {
      setStatus({ name: 'error', message: result.error ?? 'Could not save the Vimeo link.' })
      return
    }
    setUrl('')
    setStatus({ name: 'idle' })
    onChanged()
  }

  async function remove() {
    setStatus({ name: 'removing' })
    const result = await superadminJson(
      `/api/superadmin/strike/video?module_version_id=${versionId}`,
      { method: 'DELETE' },
    )
    if (!result.ok) {
      setStatus({ name: 'error', message: result.error ?? 'Could not remove the video.' })
      return
    }
    setStatus({ name: 'idle' })
    onChanged()
  }

  return (
    <div className="mt-2 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        {hasVideo ? (
          <a
            href={currentLink ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800 hover:underline dark:bg-emerald-900/40 dark:text-emerald-200"
          >
            <Video className="h-3 w-3" />
            Vimeo {videoExternalId}
          </a>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            No video
          </span>
        )}
        {hasVideo && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove()}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            {status.name === 'removing' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            Remove
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] grow">
          <Link2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={url}
            onChange={e => { setUrl(e.target.value); if (status.name === 'error') setStatus({ name: 'idle' }) }}
            placeholder={hasVideo ? 'Replace with another Vimeo link…' : 'https://vimeo.com/123456789/abcdef0123'}
            className={`w-full rounded-md border bg-white py-1 pl-7 pr-2 font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:bg-slate-900 dark:text-slate-200 ${inputInvalid ? 'border-rose-300 dark:border-rose-700' : 'border-slate-200 dark:border-slate-700'}`}
          />
        </div>
        <button
          type="button"
          disabled={busy || !parsed}
          onClick={() => void save()}
          className="inline-flex items-center gap-1 rounded-md bg-brand-navy px-2.5 py-1 font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-50"
        >
          {status.name === 'saving' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
          {hasVideo ? 'Replace' : 'Save link'}
        </button>
      </div>

      {inputInvalid && <p className="text-rose-600 dark:text-rose-300">Not a recognized Vimeo link or id.</p>}
      {status.name === 'error' && <p className="text-rose-700 dark:text-rose-300">{status.message}</p>}
    </div>
  )
}
