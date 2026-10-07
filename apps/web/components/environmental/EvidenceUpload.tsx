'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, FileText, Loader2, X } from 'lucide-react'
import { evidenceProblem, evidenceUrl, uploadEvidence } from '@/lib/environmental/evidence'
import { secondaryButtonCls } from './form'

// Attach a photo or PDF as evidence. Uploads straight to the private bucket under
// the tenant's folder, hands back the stored path, and shows a time-limited link to
// what is attached. `capture` opens the camera on a phone for photo questions.

interface Props {
  tenantId: string
  /** A short label for the storage folder, such as "permits" or "checklists". */
  folder: string
  value: string | null
  onChange: (path: string | null) => void
  label?: string
  disabled?: boolean
  capture?: boolean
  /** Photo-only screens pass image/*; permits also take PDFs. */
  accept?: string
}

export function EvidenceUpload({ tenantId, folder, value, onChange, label = 'Attach a file', disabled, capture, accept = 'image/*,application/pdf' }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setUrl(null)
    if (value) void evidenceUrl(value).then(u => { if (!cancelled) setUrl(u) })
    return () => { cancelled = true }
  }, [value])

  async function pick(file: File | undefined) {
    if (!file) return
    const problem = evidenceProblem(file)
    if (problem) { setError(problem); return }
    setBusy(true); setError(null)
    try { onChange(await uploadEvidence(tenantId, folder, file)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not upload the file.') }
    finally { setBusy(false); if (input.current) input.current.value = '' }
  }

  const isPdf = value?.toLowerCase().endsWith('.pdf')

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={input} type="file" accept={accept} {...(capture ? { capture: 'environment' as const } : {})}
          className="sr-only" aria-label={label} disabled={disabled || busy} onChange={e => void pick(e.target.files?.[0])}
        />
        <button type="button" className={secondaryButtonCls} disabled={disabled || busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {value ? 'Replace' : label}
        </button>
        {value && (
          <>
            {url
              ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">
                  {isPdf ? <FileText className="h-4 w-4" /> : null}{isPdf ? 'View document' : 'View photo'}
                </a>
              : <span className="text-xs text-slate-500">Attached</span>}
            {!disabled && (
              <button type="button" aria-label="Remove attachment" onClick={() => onChange(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="h-4 w-4" />
              </button>
            )}
          </>
        )}
      </div>
      {value && url && !isPdf && (
        // eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; the image optimizer cannot fetch it
        <img src={url} alt="Attached evidence" className="max-h-40 rounded-md border border-slate-200 object-contain dark:border-slate-800" />
      )}
      {error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
    </div>
  )
}
