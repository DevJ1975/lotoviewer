'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { compressImage, heicToJpeg, isHeic } from '@/lib/imageUtils'
import { hazWasteInspectionPhotoPath } from '@soteria/core/storagePaths'

// Controlled evidence-photo gallery for the new-inspection form. Unlike the
// hot-work AreaPhotos gallery (which loads/saves rows against an existing
// permit id), an inspection row does not exist until the form is submitted —
// so photos are uploaded against a per-form draft id and the resolved public
// URLs are lifted into form state via onChange. The parent persists them as
// the inspection's photo_urls[] on submit.
//
// Reuses the confined-space capture pipeline (HEIC decode + EXIF-correct
// compression). No subject validation; no offline queue.

interface Props {
  tenantId: string
  // Stable per-form id so a session's uploads share a storage folder.
  draftId:  string
  value:    string[]
  onChange: (urls: string[]) => void
}

const MAX_FILE_BYTES = 10_000_000
const MAX_PHOTOS = 12
const BUCKET = 'loto-photos'

type Phase = 'idle' | 'decoding' | 'compressing' | 'uploading'

export function EvidencePhotos({ tenantId, draftId, value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]   = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const atCapacity = value.length >= MAX_PHOTOS

  async function handleFile(originalFile: File) {
    setError(null)
    if (atCapacity) { setError(`At most ${MAX_PHOTOS} photos per inspection.`); return }

    const accepted = /^image\/(jpeg|png|heic|heif)$/.test(originalFile.type)
                  || /\.(heic|heif|jpg|jpeg|png)$/i.test(originalFile.name)
    if (!accepted) { setError('Only JPEG, PNG, and HEIC files are accepted.'); return }
    if (originalFile.size > MAX_FILE_BYTES) { setError('File must be under 10 MB.'); return }
    if (!tenantId) { setError('No active tenant — cannot upload.'); return }

    let file = originalFile
    if (isHeic(originalFile)) {
      setBusy('decoding')
      try {
        file = await heicToJpeg(originalFile)
      } catch (err) {
        console.error('[hw-evidence] HEIC decode failed', err)
        setError('Could not read this HEIC photo. On iPhone: Settings → Camera → Formats → Most Compatible, then retake.')
        setBusy('idle')
        return
      }
    }

    setBusy('compressing')
    let compressed: File
    try {
      compressed = await compressImage(file, 1_000_000)
    } catch (err) {
      console.error('[hw-evidence] compress failed', err)
      setError('Could not compress photo. Please try another.')
      setBusy('idle')
      return
    }

    setBusy('uploading')
    const path   = hazWasteInspectionPhotoPath(tenantId, draftId)
    const bucket = supabase.storage.from(BUCKET)
    const { error: uploadErr } = await bucket.upload(path, compressed, {
      contentType: 'image/jpeg',
      upsert:      false,
    })
    if (uploadErr) {
      console.error('[hw-evidence] upload failed', uploadErr)
      setError(`Upload failed: ${uploadErr.message}`)
      setBusy('idle')
      return
    }

    const { data: { publicUrl } } = bucket.getPublicUrl(path)
    onChange([...value, publicUrl])
    setBusy('idle')
  }

  function removeAt(index: number) {
    onChange(value.filter((_, i) => i !== index))
  }

  const busyLabel =
    busy === 'decoding'    ? 'Decoding…'
  : busy === 'compressing' ? 'Compressing…'
  : busy === 'uploading'   ? 'Uploading…'
  :                          ''

  return (
    <div className="space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        Evidence photos (optional)
      </span>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {value.map((url, i) => (
          <div key={url} className="relative h-24 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
            <Image
              src={url}
              alt={`Evidence photo ${i + 1}`}
              fill
              sizes="(max-width: 640px) 33vw, 25vw"
              className="object-cover"
              style={{ imageOrientation: 'from-image' }}
              unoptimized
            />
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={`Remove evidence photo ${i + 1}`}
              className="absolute top-1 right-1 h-6 w-6 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {!atCapacity && (
          <button
            type="button"
            onClick={() => busy === 'idle' && fileRef.current?.click()}
            disabled={busy !== 'idle'}
            aria-label="Add evidence photo"
            className="h-24 flex flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:border-brand-navy transition-colors disabled:cursor-wait"
          >
            {busy !== 'idle' ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-[10px] font-semibold">{busyLabel}</span>
              </>
            ) : (
              <>
                <Camera className="h-5 w-5" />
                <span className="text-[10px] font-semibold">Add photo</span>
              </>
            )}
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        capture="environment"
        aria-label="Add evidence photo"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}
