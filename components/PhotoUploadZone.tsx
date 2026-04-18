'use client'

import { useRef, useState, useEffect } from 'react'
import Image from 'next/image'
import { usePhotoUpload, type UploadType } from '@/hooks/usePhotoUpload'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'

interface Props {
  equipmentId: string
  type: UploadType
  label: string
  existingUrl: string | null
  onSuccess?: (url: string) => void
}

const MAX_FILE_BYTES = 10_000_000 // 10 MB

export default function PhotoUploadZone({ equipmentId, type, label, existingUrl, onSuccess }: Props) {
  const { upload, status, url, errorMsg, reset } = usePhotoUpload(equipmentId, type)
  const { online } = useNetworkStatus()
  const [dragOver, setDragOver]         = useState(false)
  const [validating, setValidating]     = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const browseRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (status === 'success' && url && onSuccess) onSuccess(url)
  }, [status, url, onSuccess])

  const displayUrl = url ?? existingUrl
  const isBusy     = validating || status === 'compressing' || status === 'uploading'
  const isBlocked  = !online || isBusy

  async function handleFile(file: File) {
    if (!online) return
    if (!file.type.match(/^image\/(jpeg|png)$/)) {
      alert('Only JPEG and PNG files are accepted.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      alert('File must be under 10 MB.')
      return
    }

    setValidating(true)
    setValidationError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('type', type)
      const res  = await fetch('/api/validate-photo', { method: 'POST', body: fd })
      const json = await res.json() as { valid?: boolean; reason?: string; error?: string }
      if (!json.valid) {
        setValidationError(json.reason ?? 'Photo does not appear to show the correct subject.')
        return
      }
    } catch {
      // If validation call fails (e.g. offline mid-check), allow upload to proceed
    } finally {
      setValidating(false)
    }

    upload(file)
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{label}</p>

      {displayUrl ? (
        <div className="relative rounded-xl overflow-hidden border border-slate-100 bg-slate-50 group">
          <Image
            src={displayUrl}
            alt={label}
            width={800}
            height={450}
            className="w-full h-48 object-cover"
            unoptimized
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
          <button
            type="button"
            onClick={() => { reset(); setTimeout(() => browseRef.current?.click(), 0) }}
            className="absolute bottom-2 right-2 bg-white/95 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm hover:bg-white transition-colors opacity-0 group-hover:opacity-100"
          >
            Replace
          </button>
          {status === 'success' && (
            <div className="absolute top-2 right-2 bg-emerald-500 text-white text-xs font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
              <span>✓</span> Saved
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={`relative flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed transition-all select-none
            ${isBusy ? 'opacity-80' : !online ? 'opacity-60' : ''}
            ${dragOver
              ? 'border-brand-navy bg-brand-navy/5'
              : 'border-slate-200 bg-slate-50/60'
            }`}
        >
          {(status === 'idle' || status === 'success') && !online && (
            <div className="text-center px-6">
              <p className="text-2xl mb-1">⚠</p>
              <p className="text-sm font-medium text-slate-500">Offline — uploads unavailable</p>
            </div>
          )}

          {(status === 'idle' || status === 'success') && online && !validating && !validationError && (
            <>
              <p className="text-sm font-medium text-slate-600 mb-3">Drop photo here or:</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => cameraRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg bg-brand-navy text-white hover:bg-brand-navy/90 transition-colors"
                >
                  📷 Camera
                </button>
                <button
                  type="button"
                  onClick={() => browseRef.current?.click()}
                  className="flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  📁 Browse
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-3">JPEG · PNG · max 10 MB</p>
            </>
          )}

          {validating                && <Spinner label="Checking photo…" />}
          {status === 'compressing' && <Spinner label="Compressing…" />}
          {status === 'uploading'   && <Spinner label="Uploading…" />}

          {validationError && (
            <div className="text-center px-6">
              <p className="text-rose-500 text-sm font-medium mb-1">Photo rejected</p>
              <p className="text-xs text-slate-400 mb-3">{validationError}</p>
              <button
                type="button"
                onClick={() => setValidationError(null)}
                className="text-xs text-brand-navy font-semibold hover:underline"
              >
                Try a different photo
              </button>
            </div>
          )}

          {status === 'error' && !validationError && (
            <div className="text-center px-6">
              <p className="text-rose-500 text-sm font-medium mb-1">Upload failed</p>
              <p className="text-xs text-slate-400 mb-3">{errorMsg}</p>
              <button
                type="button"
                onClick={() => reset()}
                className="text-xs text-brand-navy font-semibold hover:underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {/* capture="environment" opens the rear camera on Android/iOS.
          Desktop browsers ignore this attribute and show a normal file picker instead. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        aria-label={`Take photo for ${label}`}
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
      {/* File browser — standard gallery/filesystem picker */}
      <input
        ref={browseRef}
        type="file"
        accept="image/jpeg,image/png"
        aria-label={`Browse file for ${label}`}
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="w-7 h-7 border-[3px] border-brand-navy/30 border-t-brand-navy rounded-full animate-spin" />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  )
}
