'use client'

import { useEffect, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { getAttachmentUrl, type ChatAttachment } from '@/lib/chat/client'

// Renders one chat attachment. Images get an inline thumbnail (signed
// URL fetched on mount); other files get a download chip.

export default function ChatAttachmentView({ attachment }: { attachment: ChatAttachment }) {
  const { tenant } = useTenant()
  const [url, setUrl]     = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id) return
    void (async () => {
      try {
        const u = await getAttachmentUrl(tenant.id, attachment.id)
        if (!cancelled) setUrl(u)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [tenant?.id, attachment.id])

  const isImage = attachment.mime_type.startsWith('image/')
  const filename = attachment.filename ?? 'attachment'

  if (error) {
    return (
      <div className="text-xs text-rose-700 dark:text-rose-300">
        Failed to load: {error}
      </div>
    )
  }
  if (!url) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading {filename}
      </div>
    )
  }

  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block max-w-sm">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={filename}
          className="max-h-72 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 object-contain"
        />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
    >
      <FileText className="h-4 w-4 text-slate-400" />
      <span className="truncate max-w-[16rem]">{filename}</span>
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {(attachment.size_bytes / 1024).toFixed(0)} KB
      </span>
    </a>
  )
}
