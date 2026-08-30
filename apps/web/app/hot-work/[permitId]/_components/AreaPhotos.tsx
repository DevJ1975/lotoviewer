'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import Image from 'next/image'
import { Camera, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { compressImage, heicToJpeg, isHeic } from '@/lib/imageUtils'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { hotWorkPhotoPath } from '@soteria/core/storagePaths'
import {
  HOT_WORK_PHOTO_PHASE_LABELS,
  type HotWorkPermitPhoto,
  type HotWorkPhotoPhase,
} from '@soteria/core/types'

// Area-condition photo gallery for a hot work permit (OSHA 1910.252 /
// NFPA 51B). Reuses the confined-space capture pipeline (HEIC decode +
// EXIF-correct compression from lib/imageUtils) but stores many photos
// per permit in loto_hot_work_permit_photos (migration 199) rather than a
// fixed pair of *_photo_url columns.
//
// No subject validation (area photos are diagnostic — a cleared floor, a
// staged extinguisher; "wrong subject" doesn't apply) and no offline queue
// (a permit is authorized from a connected device, not mid-field), matching
// SpacePhotoSlot's deliberately simpler posture vs. PlacardPhotoSlot.

interface Props {
  permitId: string
  // Lifecycle-derived: photos taken before work completion document area
  // prep; after, they document the post-work fire watch. The parent passes
  // the phase so a freshly-captured photo is tagged correctly.
  phase:    HotWorkPhotoPhase
  // Closed permits are read-only: show the audit trail, hide capture.
  readOnly: boolean
}

const MAX_FILE_BYTES = 10_000_000
const BUCKET = 'loto-photos'

type Phase = 'idle' | 'decoding' | 'compressing' | 'uploading'

export function AreaPhotos({ permitId, phase, readOnly }: Props) {
  const { tenantId } = useTenant()
  const { profile }  = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)

  const [photos, setPhotos]   = useState<HotWorkPermitPhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<Phase>('idle')
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error: loadErr } = await supabase
      .from('loto_hot_work_permit_photos')
      .select('id, permit_id, photo_url, phase, caption, created_at, created_by')
      .eq('permit_id', permitId)
      .order('created_at', { ascending: true })
    if (loadErr) {
      console.error('[hot-work-photos] load failed', loadErr)
      setError('Could not load photos.')
    } else {
      setPhotos((data ?? []) as HotWorkPermitPhoto[])
    }
    setLoading(false)
  }, [permitId])

  useEffect(() => { load() }, [load])

  async function handleFile(originalFile: File) {
    setError(null)

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
        console.error('[hot-work-photos] HEIC decode failed', err)
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
      console.error('[hot-work-photos] compress failed', err)
      setError('Could not compress photo. Please try another.')
      setBusy('idle')
      return
    }

    setBusy('uploading')
    const path   = hotWorkPhotoPath(tenantId, permitId)
    const bucket = supabase.storage.from(BUCKET)
    const { error: uploadErr } = await bucket.upload(path, compressed, {
      contentType: 'image/jpeg',
      upsert:      false,
    })
    if (uploadErr) {
      console.error('[hot-work-photos] upload failed', uploadErr)
      setError(`Upload failed: ${uploadErr.message}`)
      setBusy('idle')
      return
    }

    const { data: { publicUrl } } = bucket.getPublicUrl(path)

    const { data: inserted, error: insertErr } = await supabase
      .from('loto_hot_work_permit_photos')
      .insert({ tenant_id: tenantId, permit_id: permitId, photo_url: publicUrl, phase, created_by: profile?.id ?? null })
      .select('id, permit_id, photo_url, phase, caption, created_at, created_by')
      .single()
    if (insertErr || !inserted) {
      console.error('[hot-work-photos] row insert failed', insertErr)
      setError(`Photo uploaded but the record failed to save: ${insertErr?.message ?? 'unknown error'}`)
      setBusy('idle')
      return
    }

    setPhotos(prev => [...prev, inserted as HotWorkPermitPhoto])
    setBusy('idle')
  }

  const busyLabel =
    busy === 'decoding'    ? 'Decoding…'
  : busy === 'compressing' ? 'Compressing…'
  : busy === 'uploading'   ? 'Uploading…'
  :                          ''

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 py-3">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading photos…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {photos.length === 0 && readOnly && (
        <p className="text-xs text-slate-500 dark:text-slate-400">No area-condition photos were attached to this permit.</p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {photos.map(photo => (
          <figure key={photo.id} className="relative rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
            <div className="relative h-32">
              <Image
                src={photo.photo_url}
                alt={`${HOT_WORK_PHOTO_PHASE_LABELS[photo.phase]} photo`}
                fill
                sizes="(max-width: 640px) 50vw, 33vw"
                className="object-cover"
                style={{ imageOrientation: 'from-image' }}
              />
            </div>
            <figcaption className="absolute top-1.5 left-1.5">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shadow ${photo.phase === 'post_work' ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'}`}>
                {HOT_WORK_PHOTO_PHASE_LABELS[photo.phase]}
              </span>
            </figcaption>
          </figure>
        ))}

        {!readOnly && (
          <button
            type="button"
            onClick={() => busy === 'idle' && fileRef.current?.click()}
            disabled={busy !== 'idle'}
            aria-label="Add area-condition photo"
            className="h-32 flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-400 dark:text-slate-500 hover:text-brand-navy hover:border-brand-navy transition-colors disabled:cursor-wait"
          >
            {busy !== 'idle' ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-[11px] font-semibold">{busyLabel}</span>
              </>
            ) : (
              <>
                <Camera className="h-6 w-6" />
                <span className="text-[11px] font-semibold">Add photo</span>
              </>
            )}
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-600 dark:text-rose-300">{error}</p>}

      {!readOnly && (
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
          capture="environment"
          aria-label="Add area-condition photo"
          className="sr-only"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
        />
      )}
    </div>
  )
}
