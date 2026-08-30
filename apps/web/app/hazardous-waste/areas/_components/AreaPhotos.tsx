'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { Camera, Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { compressImage, heicToJpeg, isHeic } from '@/lib/imageUtils'
import { hazWasteAreaPhotoPath } from '@soteria/core/storagePaths'

// Reference-photo gallery for an accumulation area. Unlike the inspection
// EvidencePhotos gallery (which uploads against a per-form draft id and lifts
// URLs into form state), an area row already exists — so each change is
// persisted immediately by the parent via onChange. Reuses the same HEIC
// decode + EXIF-correct compression pipeline.

interface Props {
  tenantId: string
  areaId:   string
  value:    string[]
  canWrite: boolean
  // Persist the new URL list (the parent PATCHes the area + reloads).
  onChange: (urls: string[]) => void | Promise<void>
}

const MAX_FILE_BYTES = 10_000_000
const MAX_PHOTOS = 20
const BUCKET = 'loto-photos'

type Phase = 'idle' | 'decoding' | 'compressing' | 'uploading'

export function AreaPhotos({ tenantId, areaId, value, canWrite, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]   = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)

  const atCapacity = value.length >= MAX_PHOTOS

  async function handleFile(originalFile: File) {
    setError(null)
    if (atCapacity) { setError(`At most ${MAX_PHOTOS} photos per area.`); return }

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
        console.error('[hw-area-photo] HEIC decode failed', err)
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
      console.error('[hw-area-photo] compress failed', err)
      setError('Could not compress photo. Please try another.')
      setBusy('idle')
      return
    }

    setBusy('uploading')
    const path   = hazWasteAreaPhotoPath(tenantId, areaId)
    const bucket = supabase.storage.from(BUCKET)
    const { error: uploadErr } = await bucket.upload(path, compressed, {
      contentType: 'image/jpeg',
      upsert:      false,
    })
    if (uploadErr) {
      console.error('[hw-area-photo] upload failed', uploadErr)
      setError(`Upload failed: ${uploadErr.message}`)
      setBusy('idle')
      return
    }

    const { data: { publicUrl } } = bucket.getPublicUrl(path)
    try {
      await onChange([...value, publicUrl])
    } finally {
      setBusy('idle')
    }
  }

  function removeAt(index: number) {
    void onChange(value.filter((_, i) => i !== index))
  }

  if (value.length === 0 && !canWrite) return null

  const busyLabel =
    busy === 'decoding'    ? 'Decoding…'
  : busy === 'compressing' ? 'Compressing…'
  : busy === 'uploading'   ? 'Uploading…'
  :                          ''

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {value.map((url, i) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="relative h-16 w-16 rounded-md overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40"
          >
            <Image
              src={url}
              alt={`Area photo ${i + 1}`}
              fill
              sizes="64px"
              className="object-cover"
              style={{ imageOrientation: 'from-image' }}
              unoptimized
            />
            {canWrite && (
              <button
                type="button"
                onClick={e => { e.preventDefault(); removeAt(i) }}
                aria-label={`Remove area photo ${i + 1}`}
                className="absolute top-0.5 right-0.5 h-5 w-5 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </a>
        ))}

        {canWrite && !atCapacity && (
          <button
            type="button"
            onClick={() => busy === 'idle' && fileRef.current?.click()}
            disabled={busy !== 'idle'}
            aria-label="Add area photo"
            className="h-16 w-16 flex flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:border-brand-navy transition-colors disabled:cursor-wait"
          >
            {busy !== 'idle'
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Camera className="h-4 w-4" />}
            <span className="text-[9px] font-semibold">{busy !== 'idle' ? busyLabel : 'Photo'}</span>
          </button>
        )}
      </div>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}

      {canWrite && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
          capture="environment"
          aria-label="Add area photo"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = '' }}
        />
      )}
    </div>
  )
}
