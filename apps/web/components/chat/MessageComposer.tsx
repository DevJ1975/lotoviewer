'use client'

import { useRef, useState } from 'react'
import { Loader2, Paperclip, Send, X } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { uploadAttachment } from '@/lib/chat/client'
import MentionInput, { type MentionMember } from '@/components/MentionInput'
import { compressImage, isHeic, heicToJpeg } from '@/lib/imageUtils'

// Slack-style composer: text body + optional file attachments.
// Attachments upload immediately so the user sees the chip; the post
// handler in the parent claims them by id when sending.

const ATTACH_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,application/pdf,text/plain,text/csv'
const MAX_ATTACHMENTS = 5

interface PendingAttachment {
  id:        string
  filename:  string
  mime_type: string
}

interface Props {
  channelId:    string
  members:      MentionMember[]
  onSent:       (body: string, attachmentIds: string[]) => Promise<void>
  placeholder?: string
}

export default function MessageComposer({ channelId, members, onSent, placeholder }: Props) {
  const { tenant } = useTenant()
  const fileRef = useRef<HTMLInputElement>(null)

  const [draft, setDraft]       = useState('')
  const [pending, setPending]   = useState<PendingAttachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [posting, setPosting]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function attachFiles(files: FileList | null) {
    if (!files || !tenant?.id) return
    if (pending.length + files.length > MAX_ATTACHMENTS) {
      setError(`Up to ${MAX_ATTACHMENTS} attachments per message.`)
      return
    }
    setUploading(true); setError(null)
    try {
      for (const f of Array.from(files)) {
        let prepared = f
        if (isHeic(f)) {
          try { prepared = await heicToJpeg(f) }
          catch {
            throw new Error('HEIC images are only supported in Safari. Pick a JPEG/PNG instead.')
          }
        }
        if (prepared.type.startsWith('image/')) {
          // Resize big phone snaps so chat history doesn't bloat.
          prepared = await compressImage(prepared, 5_000_000)
        }
        const a = await uploadAttachment(tenant.id, channelId, prepared)
        setPending(prev => [...prev, {
          id:        a.id,
          filename:  a.filename ?? prepared.name,
          mime_type: a.mime_type,
        }])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function removeAttachment(id: string) {
    setPending(prev => prev.filter(p => p.id !== id))
  }

  async function send() {
    const text = draft.trim()
    if (!text && pending.length === 0) return
    setPosting(true); setError(null)
    try {
      await onSent(text, pending.map(p => p.id))
      setDraft('')
      setPending([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ctrl/Cmd-Enter to send (matches the existing description editor).
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="border-t border-slate-200 dark:border-slate-800 p-3 bg-white dark:bg-slate-900" onKeyDown={handleKey}>
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {pending.map(p => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200">
              <Paperclip className="h-3 w-3" />
              {p.filename}
              <button
                type="button"
                onClick={() => removeAttachment(p.id)}
                className="text-slate-400 hover:text-rose-500"
                title="Remove attachment"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || posting || pending.length >= MAX_ATTACHMENTS}
          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
          title="Attach files"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept={ATTACH_ACCEPT}
          onChange={e => void attachFiles(e.target.files)}
          className="hidden"
        />
        <div className="flex-1">
          <MentionInput
            value={draft}
            onChange={setDraft}
            members={members}
            placeholder={placeholder ?? 'Message. Cmd+Enter to send. Use @name to ping.'}
            rows={1}
            disabled={posting}
          />
        </div>
        <button
          type="button"
          onClick={() => void send()}
          disabled={posting || (!draft.trim() && pending.length === 0)}
          className="rounded-lg bg-brand-navy text-white px-3 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50 inline-flex items-center gap-1"
        >
          {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          <span className="hidden sm:inline">Send</span>
        </button>
      </div>
      {error && (
        <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{error}</p>
      )}
    </div>
  )
}
