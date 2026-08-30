'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Camera, Loader2, Trash2, Upload, ArrowLeft, CameraOff } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { MAX_CAPTURE_PAGES } from '@/lib/sdsCapture'

// Photograph a paper SDS page-by-page (or upload photos), then submit. The
// server assembles the images into a PDF and runs the parse → review pipeline.
export default function CaptureSdsPage() {
  const { tenant } = useTenant()
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const productId = params.id

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [pages, setPages] = useState<string[]>([])
  const [camOn, setCamOn] = useState(false)
  const [camError, setCamError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    setCamOn(false)
  }, [])

  const startCamera = useCallback(async () => {
    setCamError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      setCamOn(true)
    } catch (e) {
      setCamError(e instanceof Error ? e.message : 'Camera unavailable')
    }
  }, [])

  useEffect(() => () => stopCamera(), [stopCamera])

  const capture = useCallback(() => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    if (pages.length >= MAX_CAPTURE_PAGES) { toast.error(`Max ${MAX_CAPTURE_PAGES} pages.`); return }
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    setPages(p => [...p, canvas.toDataURL('image/jpeg', 0.85)])
  }, [pages.length])

  const onFiles = useCallback((files: FileList | null) => {
    if (!files) return
    const room = MAX_CAPTURE_PAGES - pages.length
    Array.from(files).slice(0, Math.max(0, room)).forEach(file => {
      const reader = new FileReader()
      reader.onload = () => { if (typeof reader.result === 'string') setPages(p => [...p, reader.result as string]) }
      reader.readAsDataURL(file)
    })
  }, [pages.length])

  const submit = useCallback(async () => {
    if (pages.length === 0) { toast.error('Capture at least one page.'); return }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '', 'content-type': 'application/json' }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/chemicals/products/${productId}/sds/capture`, {
        method: 'POST', headers, body: JSON.stringify({ images: pages }),
      })
      const body = await res.json()
      if (!res.ok) { toast.error(body.error ?? `Capture failed (HTTP ${res.status})`); return }
      stopCamera()
      toast.success(body.parsed_ok
        ? 'SDS captured and parsed — review it in the queue.'
        : 'SDS captured. Parse it from the product page when ready.')
      router.push(`/chemicals/${productId}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }, [pages, productId, tenant, router, stopCamera])

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <header className="space-y-2">
        <Link href={`/chemicals/${productId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="w-4 h-4" /> Back to product
        </Link>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Capture paper SDS</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Photograph each page of the printed SDS. We&apos;ll assemble them into a PDF and parse it — photo
          captures always go through the review queue before any field is applied.
        </p>
      </header>

      <div className="rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-950">
        <video ref={videoRef} playsInline muted className={`w-full ${camOn ? 'block' : 'hidden'}`} />
        {!camOn && (
          <div className="aspect-video flex flex-col items-center justify-center gap-3 text-slate-400">
            <CameraOff className="w-8 h-8" />
            <span className="text-sm">{camError ?? 'Camera is off'}</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {!camOn ? (
          <button type="button" onClick={() => void startCamera()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
            <Camera className="w-4 h-4" /> Start camera
          </button>
        ) : (
          <>
            <button type="button" onClick={capture}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
              <Camera className="w-4 h-4" /> Capture page
            </button>
            <button type="button" onClick={stopCamera}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800">
              <CameraOff className="w-4 h-4" /> Stop
            </button>
          </>
        )}
        <label className="inline-flex items-center gap-2 px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
          <Upload className="w-4 h-4" /> Upload photos
          <input type="file" accept="image/jpeg,image/png" multiple className="hidden"
            onChange={e => { onFiles(e.target.files); e.target.value = '' }} />
        </label>
      </div>

      {pages.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {pages.length} page{pages.length === 1 ? '' : 's'} captured
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {pages.map((src, i) => (
              <div key={i} className="relative group">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Page ${i + 1}`} className="w-full h-28 object-cover rounded border border-slate-200 dark:border-slate-800" />
                <button type="button" onClick={() => setPages(p => p.filter((_, idx) => idx !== i))}
                  className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100"
                  aria-label={`Remove page ${i + 1}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 text-[10px] rounded bg-black/60 text-white">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <button type="button" onClick={() => void submit()} disabled={submitting || pages.length === 0}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-medium">
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
          Submit {pages.length > 0 ? `(${pages.length})` : ''}
        </button>
      </div>
    </div>
  )
}
