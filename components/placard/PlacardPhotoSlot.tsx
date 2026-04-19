'use client'

import { useRef, useState, useEffect } from 'react'
import Image from 'next/image'
import { usePhotoUpload, type UploadType } from '@/hooks/usePhotoUpload'

interface Props {
  equipmentId: string
  type:        UploadType
  label:       string
  existingUrl: string | null
  onSuccess?:  (url: string) => void
  onError?:    (message: string) => void
}

const MAX_FILE_BYTES = 10_000_000

export default function PlacardPhotoSlot({ equipmentId, type, label, existingUrl, onSuccess, onError }: Props) {
  const { upload, status, url, errorMsg, reset } = usePhotoUpload(equipmentId, type)
  const fileRef = useRef<HTMLInputElement>(null)
  const [validating, setValidating]     = useState(false)

  useEffect(() => {
    if (status === 'success' && url && onSuccess) onSuccess(url)
    if (status === 'error'   && errorMsg && onError) onError(errorMsg)
  }, [status, url, errorMsg, onSuccess, onError])

  const displayUrl = url ?? existingUrl
  const isBusy     = validating || status === 'compressing' || status === 'uploading'

  async function handleFile(file: File) {
    if (!file.type.match(/^image\/(jpeg|png)$/)) {
      onError?.('Only JPEG and PNG files are accepted.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      onError?.('File must be under 10 MB.')
      return
    }

    setValidating(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', type)
      const res  = await fetch('/api/validate-photo', { method: 'POST', body: fd })
      const json = await res.json() as { valid?: boolean; reason?: string }
      if (json && json.valid === false) {
        onError?.(json.reason ?? 'Photo does not appear to show the correct subject.')
        return
      }
    } catch {
      // If validation unreachable, allow upload
    } finally {
      setValidating(false)
    }

    upload(file)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Caption bar */}
      <div className="bg-[#214487] text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 text-center">
        {label}
      </div>

      {/* Photo slot */}
      <button
        type="button"
        onClick={() => !isBusy && fileRef.current?.click()}
        disabled={isBusy}
        aria-label={`Upload ${label}`}
        className="flex-1 relative bg-slate-50 border-2 border-slate-200 border-t-0 overflow-hidden group disabled:cursor-wait"
      >
        {displayUrl && !isBusy ? (
          <>
            <Image
              src={displayUrl}
              alt={label}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className="object-cover"
              unoptimized
            />
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <span className="opacity-0 group-hover:opacity-100 bg-white/95 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-opacity">
                Replace
              </span>
            </div>
            {status === 'success' && (
              <span className="absolute top-1.5 right-1.5 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                ✓ Saved
              </span>
            )}
          </>
        ) : isBusy ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-7 h-7 border-[3px] border-brand-navy/30 border-t-brand-navy rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-medium">
              {validating ? 'Checking…' : status === 'compressing' ? 'Compressing…' : 'Uploading…'}
            </p>
          </div>
        ) : status === 'error' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <p className="text-rose-500 text-xs font-semibold">Upload failed</p>
            <p className="text-[11px] text-slate-400 line-clamp-2">{errorMsg}</p>
            <button
              type="button"
              onClick={e => { e.stopPropagation(); reset() }}
              className="text-[11px] text-brand-navy font-semibold hover:underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 group-hover:text-brand-navy transition-colors">
            <div className="w-10 h-10 rounded-full border-2 border-current flex items-center justify-center text-xl">+</div>
            <p className="text-xs font-semibold">Click to upload</p>
            <p className="text-[10px]">JPEG or PNG</p>
          </div>
        )}
      </button>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        aria-label={`Upload ${label}`}
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}
