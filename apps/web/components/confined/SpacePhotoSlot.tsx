'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { compressImage, heicToJpeg, isHeic } from '@/lib/imageUtils'
import { useTenant } from '@/components/TenantProvider'
import { confinedSpacePhotoPath } from '@soteria/core/storagePaths'

// Photo slot for confined spaces. Simpler than PlacardPhotoSlot:
//   • No subject validation (confined-space photos are diagnostic — interior
//     residue, manway shape, drain config; "wrong subject" doesn't exist).
//   • No upload queue (inventory photos are taken from a connected device,
//     not from the iPad in front of a tank). Failures surface as errors.
//   • No realtime status — caller updates the space row directly after the
//     URL lands and the optimistic UI in the parent re-renders.
// Reuses the HEIC + compression + EXIF-orientation pipeline from
// lib/imageUtils so iPhone photos arrive right-side-up regardless of camera
// format settings.

interface Props {
  spaceId:     string
  slot:        'exterior' | 'interior'    // matches the column on loto_confined_spaces
  label:       string
  existingUrl: string | null
  onUploaded:  (publicUrl: string) => void
  onError?:    (message: string) => void
}

const MAX_FILE_BYTES = 10_000_000
const BUCKET = 'loto-photos'

export default function SpacePhotoSlot({ spaceId, slot, label, existingUrl, onUploaded, onError }: Props) {
  const { tenantId } = useTenant()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy]                 = useState(false)
  const [phase, setPhase]               = useState<'idle' | 'decoding' | 'compressing' | 'uploading'>('idle')
  const [errorState, setErrorState]     = useState<string | null>(null)
  const [localPreview, setLocalPreview] = useState<string | null>(null)
  const [savedUrl, setSavedUrl]         = useState<string | null>(null)

  // Stable callback ref so the parent passing inline closures doesn't trigger
  // re-renders during upload. Mirrors the pattern in PlacardPhotoSlot.
  const onUploadedRef = useRef(onUploaded)
  const onErrorRef    = useRef(onError)
  onUploadedRef.current = onUploaded
  onErrorRef.current    = onError

  useEffect(() => {
    return () => { if (localPreview) URL.revokeObjectURL(localPreview) }
  }, [localPreview])

  function fail(msg: string) {
    setErrorState(msg)
    onErrorRef.current?.(msg)
  }

  async function handleFile(originalFile: File) {
    setErrorState(null)

    const isAccepted = /^image\/(jpeg|png|heic|heif)$/.test(originalFile.type)
                    || /\.(heic|heif|jpg|jpeg|png)$/i.test(originalFile.name)
    if (!isAccepted) { fail('Only JPEG, PNG, and HEIC files are accepted.'); return }
    if (originalFile.size > MAX_FILE_BYTES) { fail('File must be under 10 MB.'); return }

    setBusy(true)
    let file = originalFile
    if (isHeic(originalFile)) {
      setPhase('decoding')
      try {
        file = await heicToJpeg(originalFile)
      } catch (err) {
        console.error('[space-photo] HEIC decode failed', err)
        fail('Could not read this HEIC photo. On iPhone: Settings → Camera → Formats → Most Compatible, then retake.')
        setBusy(false); setPhase('idle')
        return
      }
    }

    setLocalPreview(URL.createObjectURL(file))

    setPhase('compressing')
    let compressed: File
    try {
      compressed = await compressImage(file, 1_000_000)
    } catch (err) {
      console.error('[space-photo] compress failed', err)
      fail('Could not compress photo. Please try another.')
      setBusy(false); setPhase('idle')
      return
    }

    setLocalPreview(URL.createObjectURL(compressed))

    if (!tenantId) {
      fail('No active tenant — cannot upload.')
      setBusy(false); setPhase('idle')
      return
    }

    setPhase('uploading')
    const path = confinedSpacePhotoPath(tenantId, spaceId, slot)
    const bucket = supabase.storage.from(BUCKET)

    // upsert: false to fail loudly if path already exists. The timestamp
    // suffix makes collisions virtually impossible — but re-uploading the
    // same slot intentionally writes a new file rather than overwriting,
    // so the storage history reflects every photo the user picked.
    const { error: uploadErr } = await bucket.upload(path, compressed, {
      contentType: 'image/jpeg',
      upsert:      false,
    })
    if (uploadErr) {
      console.error('[space-photo] upload failed', uploadErr)
      fail(`Upload failed: ${uploadErr.message}`)
      setBusy(false); setPhase('idle')
      return
    }

    const { data: { publicUrl } } = bucket.getPublicUrl(path)

    // Patch the row so future renders read the saved URL. Caller's onUploaded
    // also patches local state for instant feedback.
    const column = slot === 'exterior' ? 'equip_photo_url' : 'interior_photo_url'
    const { error: updateErr } = await supabase
      .from('loto_confined_spaces')
      .update({ [column]: publicUrl, updated_at: new Date().toISOString() })
      .eq('space_id', spaceId)

    if (updateErr) {
      console.error('[space-photo] row update failed', updateErr)
      fail(`Photo uploaded but the row update failed: ${updateErr.message}`)
      setBusy(false); setPhase('idle')
      return
    }

    setSavedUrl(publicUrl)
    onUploadedRef.current(publicUrl)
    setBusy(false); setPhase('idle')
  }

  const displayUrl = savedUrl ?? localPreview ?? existingUrl
  const phaseLabel =
    phase === 'decoding'    ? 'Decoding…'
  : phase === 'compressing' ? 'Compressing…'
  : phase === 'uploading'   ? 'Uploading…'
  :                            ''

  return (
    <div className="flex flex-col">
      <div className="bg-[#214487] text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 text-center rounded-t-lg">
        {label}
      </div>
      <button
        type="button"
        onClick={() => !busy && fileRef.current?.click()}
        disabled={busy}
        aria-label={`Upload ${label}`}
        className="relative h-48 bg-slate-50 dark:bg-slate-900/40 border-2 border-t-0 border-slate-200 dark:border-slate-700 rounded-b-lg overflow-hidden group disabled:cursor-wait"
      >
        {displayUrl ? (
          <>
            <Image
              src={displayUrl}
              alt={label}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className={`object-cover transition-opacity duration-150 ${busy ? 'opacity-40' : 'opacity-100'}`}
              style={{ imageOrientation: 'from-image' }}
              unoptimized
            />
            {busy ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/30 dark:bg-slate-900/30 backdrop-blur-[1px]">
                <div className="w-7 h-7 border-[3px] border-brand-navy/30 border-t-brand-navy rounded-full animate-spin" />
                <p className="text-xs text-slate-700 dark:text-slate-300 font-semibold">{phaseLabel}</p>
              </div>
            ) : (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 bg-white/95 dark:bg-slate-900/95 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-opacity">
                  Replace
                </span>
              </div>
            )}
            {!busy && savedUrl && (
              <span className="absolute top-1.5 right-1.5 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                ✓ Saved
              </span>
            )}
          </>
        ) : busy ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-7 h-7 border-[3px] border-brand-navy/30 border-t-brand-navy rounded-full animate-spin" />
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{phaseLabel}</p>
          </div>
        ) : errorState ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <p className="text-rose-500 text-xs font-semibold">Upload failed</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{errorState}</p>
            <span className="text-[11px] text-brand-navy font-semibold">Tap to try again</span>
          </div>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-500 group-hover:text-brand-navy transition-colors">
            <div className="w-10 h-10 rounded-full border-2 border-current flex items-center justify-center text-xl">+</div>
            <p className="text-xs font-semibold">Click to upload</p>
            <p className="text-[10px]">JPEG, PNG, or HEIC</p>
          </div>
        )}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        capture="environment"
        aria-label={`Upload ${label}`}
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = '' }}
      />
    </div>
  )
}
