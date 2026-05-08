'use client'

import { useRef, useState } from 'react'
import { Loader2, Paperclip, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { uploadBoardAttachment } from '@/lib/safetyBoards/client'
import { compressImage, isHeic, heicToJpeg } from '@/lib/imageUtils'

// Compact attach-files chip-strip used by both the new-thread form
// and the reply composer. State is held by the parent; this component
// just runs the upload pipeline (HEIC → JPEG, compress, POST) and
// reports the resulting attachment ids.

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,application/pdf,text/plain,text/csv'
const MAX = 5

export interface PendingAttachment {
  id:        string
  filename:  string
  mime_type: string
}

interface Props {
  pending: PendingAttachment[]
  onChange: (next: PendingAttachment[]) => void
  disabled?: boolean
}

export default function AttachFiles({ pending, onChange, disabled }: Props) {
  const { tenant } = useTenant()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function attach(files: FileList | null) {
    if (!files || !tenant?.id) return
    if (pending.length + files.length > MAX) {
      setError(`Up to ${MAX} attachments per post.`)
      return
    }
    setBusy(true); setError(null)
    try {
      const next = [...pending]
      for (const f of Array.from(files)) {
        let prepared = f
        if (isHeic(f)) {
          try { prepared = await heicToJpeg(f) }
          catch {
            throw new Error('HEIC images are only supported in Safari. Pick a JPEG/PNG instead.')
          }
        }
        if (prepared.type.startsWith('image/')) {
          prepared = await compressImage(prepared, 5_000_000)
        }
        const a = await uploadBoardAttachment(tenant.id, prepared)
        next.push({ id: a.id, filename: a.filename ?? prepared.name, mime_type: a.mime_type })
      }
      onChange(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function remove(id: string) {
    onChange(pending.filter(p => p.id !== id))
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1.5 items-center">
        {pending.map(p => (
          <span key={p.id} className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200">
            <Paperclip className="h-3 w-3" />
            {p.filename}
            <button
              type="button"
              onClick={() => remove(p.id)}
              className="text-slate-400 hover:text-rose-500"
              title="Remove"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy || disabled || pending.length >= MAX}
          className="inline-flex items-center gap-1 rounded ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-0.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Paperclip className="h-3 w-3" />}
          Attach
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ACCEPT}
          onChange={e => void attach(e.target.files)}
          className="hidden"
        />
      </div>
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  )
}
