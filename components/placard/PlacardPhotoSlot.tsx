'use client'

import { useRef, useState, useEffect } from 'react'
import Image from 'next/image'
import { usePhotoUpload, type UploadType } from '@/hooks/usePhotoUpload'
import { useNetworkStatus } from '@/hooks/useNetworkStatus'
import { useUploadQueue } from '@/components/UploadQueueProvider'
import { compressImage } from '@/lib/imageUtils'
import { haptic } from '@/lib/platform'

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
  const { upload, status, url, reset } = usePhotoUpload(equipmentId, type)
  const { online } = useNetworkStatus()
  const { enqueue, queuedKeys } = useUploadQueue()

  const fileRef = useRef<HTMLInputElement>(null)
  const [validating, setValidating] = useState(false)
  const [queueing, setQueueing]     = useState(false)
  const [compressing, setCompressing] = useState(false)
  const [localPreview, setLocalPreview] = useState<string | null>(null)

  // Keep latest callback refs so the success effect doesn't re-fire when the
  // parent passes new inline closures — would cause an infinite re-render loop.
  const onSuccessRef = useRef(onSuccess)
  const onErrorRef   = useRef(onError)
  onSuccessRef.current = onSuccess
  onErrorRef.current   = onError

  // Fire success callback only when status/url transitions — NOT when the
  // parent hands us a new closure reference.
  const firedSuccessForRef = useRef<string | null>(null)
  useEffect(() => {
    if (status === 'success' && url && firedSuccessForRef.current !== url) {
      firedSuccessForRef.current = url
      haptic('success')
      onSuccessRef.current?.(url)
    }
    if (status !== 'success') {
      firedSuccessForRef.current = null
    }
  }, [status, url])

  // Revoke blob URL when component unmounts or preview replaced
  useEffect(() => {
    return () => { if (localPreview) URL.revokeObjectURL(localPreview) }
  }, [localPreview])

  // "Queued" is driven entirely by the live queue state in UploadQueueProvider.
  // Previously we also tracked a one-way `justQueued` flag that never reset,
  // which left the badge reading "☁︎ Queued" on photos that had already
  // synced. Since `enqueue()` awaits the queue refresh before resolving,
  // queuedKeys already reflects the new entry by the time this re-renders —
  // no separate flag needed.
  const isQueuedForThisSlot = queuedKeys.has(`${equipmentId}:${type}`)
  const displayUrl  = url ?? localPreview ?? existingUrl
  const isBusy      = validating || queueing || compressing || status === 'uploading'
  const showQueued  = isQueuedForThisSlot && !url
  // Once the photo is safely in the offline queue, hide the live-upload
  // error surface — the queue drain will retry it and "Upload failed"
  // would be misleading.
  const showError   = status === 'error' && !isQueuedForThisSlot

  async function enqueueCompressed(blob: Blob) {
    setQueueing(true)
    try {
      await enqueue({ equipmentId, type, blob })
      onSuccessRef.current?.('Upload queued — will sync when online.')
    } catch {
      onErrorRef.current?.('Upload failed. Changes saved locally and queued for your next sync.')
    } finally {
      setQueueing(false)
    }
  }

  async function handleFile(file: File) {
    if (!file.type.match(/^image\/(jpeg|png)$/)) {
      onErrorRef.current?.('Only JPEG and PNG files are accepted.')
      return
    }
    if (file.size > MAX_FILE_BYTES) {
      onErrorRef.current?.('File must be under 10 MB.')
      return
    }

    // Show the raw file as a preview immediately — without this, the user
    // stares at a spinner for ~500ms-2s while validation + compression run,
    // with no visual confirmation of what they just selected. The preview
    // is swapped for the EXIF-corrected compressed blob when that's ready.
    // CSS image-orientation:from-image on the <Image> keeps raw-file
    // orientation correct in the meantime.
    setLocalPreview(URL.createObjectURL(file))

    // Validate subject (skip if offline — don't waste time)
    if (online) {
      setValidating(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('type', type)
        const res  = await fetch('/api/validate-photo', { method: 'POST', body: fd })
        const json = await res.json() as { valid?: boolean; reason?: string }
        if (json && json.valid === false) {
          onErrorRef.current?.(json.reason ?? 'Photo does not appear to show the correct subject.')
          setValidating(false)
          return
        }
      } catch {
        // Validation unreachable — proceed anyway
      } finally {
        setValidating(false)
      }
    }

    // Compress locally so we have a bounded Blob for both upload and queue.
    // The upload hook does NOT re-compress — we own compression here so it
    // runs exactly once regardless of online/offline path.
    let compressed: File
    setCompressing(true)
    try {
      compressed = await compressImage(file, 1_000_000)
    } catch (err) {
      // Log the real error for field-device debugging; surface a friendly
      // message to the user. Matches the pattern from the upload-queue
      // debug commit — stop swallowing decode failures silently.
      console.error('[photo] compress failed', err)
      onErrorRef.current?.('Could not compress photo. Please try another.')
      return
    } finally {
      setCompressing(false)
    }

    // Store a preview so the slot shows the image immediately
    setLocalPreview(URL.createObjectURL(compressed))

    if (!online) {
      await enqueueCompressed(compressed)
      return
    }

    // Attempt live upload via the hook (will retry with exponential backoff)
    const publicUrl = await upload(compressed)

    if (!publicUrl) {
      // Upload failed online — queue for later
      await enqueueCompressed(compressed)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="bg-[#214487] text-white text-[11px] font-bold uppercase tracking-wider px-2 py-1 text-center">
        {label}
      </div>

      <button
        type="button"
        onClick={() => !isBusy && fileRef.current?.click()}
        disabled={isBusy}
        aria-label={`Upload ${label}`}
        className="flex-1 relative bg-slate-50 border-2 border-slate-200 border-t-0 overflow-hidden group disabled:cursor-wait"
      >
        {displayUrl ? (
          <>
            <Image
              src={displayUrl}
              alt={label}
              fill
              sizes="(max-width: 768px) 100vw, 50vw"
              className={`object-cover transition-opacity duration-150 ${isBusy ? 'opacity-40' : 'opacity-100'}`}
              style={{ imageOrientation: 'from-image' }}
              unoptimized
            />
            {isBusy ? (
              // Busy overlay on top of the preview, so the user keeps seeing
              // what they picked during validation/compression/upload.
              // Previously the spinner replaced the image, hiding their
              // selection for 500ms–2s after a file pick.
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/30 backdrop-blur-[1px]">
                <div className="w-7 h-7 border-[3px] border-brand-navy/30 border-t-brand-navy rounded-full animate-spin" />
                <p className="text-xs text-slate-700 font-semibold drop-shadow-sm">
                  {validating  ? 'Checking…'  :
                   queueing    ? 'Queueing…'  :
                   compressing ? 'Compressing…' : 'Uploading…'}
                </p>
              </div>
            ) : (
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover:opacity-100 bg-white/95 text-xs font-semibold px-3 py-1.5 rounded-lg shadow-sm transition-opacity">
                  Replace
                </span>
              </div>
            )}
            {!isBusy && showQueued && (
              <span className="absolute top-1.5 right-1.5 bg-amber-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow flex items-center gap-1">
                ☁︎ Queued
              </span>
            )}
            {!isBusy && !showQueued && status === 'success' && (
              <span className="absolute top-1.5 right-1.5 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow">
                ✓ Saved
              </span>
            )}
          </>
        ) : isBusy ? (
          // No preview yet (empty slot, just-picked file still being read).
          // Rare — setLocalPreview runs synchronously on file pick, so this
          // path only shows for edge cases where the busy state kicks in
          // before a preview is available.
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
            <div className="w-7 h-7 border-[3px] border-brand-navy/30 border-t-brand-navy rounded-full animate-spin" />
            <p className="text-xs text-slate-500 font-medium">
              {validating  ? 'Checking…'  :
               queueing    ? 'Queueing…'  :
               compressing ? 'Compressing…' : 'Uploading…'}
            </p>
          </div>
        ) : showError ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
            <p className="text-rose-500 text-xs font-semibold">Upload failed</p>
            <p className="text-[11px] text-slate-400">Please try again.</p>
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
