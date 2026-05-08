'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2, ScanLine } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Camera-driven barcode scan that resolves CHEM-* codes to a container
// detail page. Falls back to manual entry on devices without the
// BarcodeDetector API (Safari, older Android browsers).

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | ImageBitmap): Promise<{ rawValue: string }[]>
}
type BarcodeDetectorCtor = new (opts: { formats: string[] }) => BarcodeDetectorLike

declare global {
  interface Window {
    BarcodeDetector?: BarcodeDetectorCtor
  }
}

export default function ChemicalScanPage() {
  const router = useRouter()
  const { tenant } = useTenant()
  const videoRef  = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [supported, setSupported] = useState<boolean | null>(null)
  const [active, setActive]       = useState(false)
  const [code,   setCode]         = useState('')
  const [busy,   setBusy]         = useState(false)
  const [error,  setError]        = useState<string | null>(null)

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActive(false)
  }, [])

  const resolve = useCallback(async (rawCode: string) => {
    if (!tenant?.id) return
    setBusy(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      // QR codes on labels encode an absolute URL to the chemical detail
      // page; if it looks like a URL with /chemicals/<uuid>, hop straight
      // there. Otherwise treat it as an inventory barcode.
      const productMatch = rawCode.match(/\/chemicals\/([0-9a-f-]{36})/i)
      if (productMatch) {
        router.push(`/chemicals/${productMatch[1]}`)
        return
      }

      const params = new URLSearchParams({ code: rawCode })
      const res  = await fetch(`/api/chemicals/inventory/scan?${params}`, { headers })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      router.push(`/chemicals/inventory/${body.item.id}`)
    } finally {
      setBusy(false)
    }
  }, [tenant, router])

  // Hold the latest resolve in a ref so the camera-tick closure can
  // call it without forcing the startCamera callback to re-create
  // every time tenant/router changes.
  const resolveRef = useRef(resolve)
  useEffect(() => { resolveRef.current = resolve }, [resolve])

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && 'BarcodeDetector' in window)
    return () => stopCamera()
  }, [stopCamera])

  const startCamera = useCallback(async () => {
    setError(null)
    if (!supported) {
      setError('This browser does not support camera barcode detection. Use the manual entry below.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)

      const detector = new window.BarcodeDetector!({
        formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8'],
      })

      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return
        try {
          const found = await detector.detect(videoRef.current)
          if (found.length > 0) {
            const v = found[0].rawValue.trim()
            stopCamera()
            await resolveRef.current(v)
            return
          }
        } catch {
          /* transient detector failure; keep polling */
        }
        if (streamRef.current) requestAnimationFrame(() => void tick())
      }
      void tick()
    } catch (e) {
      setError(`Camera error: ${e instanceof Error ? e.message : String(e)}`)
      setActive(false)
    }
  }, [supported, stopCamera])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/chemicals" className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline">
        <ArrowLeft className="w-4 h-4" /> Back to catalog
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <ScanLine className="w-6 h-6" /> Scan barcode
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Point your camera at a label QR or barcode. CHEM-… codes resolve to a container; chemical-detail QR codes jump straight to that chemical.
        </p>
      </header>

      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        {supported === false && (
          <div className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            Your browser does not support live barcode detection. Type or paste the code below.
          </div>
        )}

        <div className={`relative aspect-[4/3] rounded overflow-hidden bg-slate-900 ${active ? '' : 'opacity-60'}`}>
          <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
          {!active && (
            <div className="absolute inset-0 flex items-center justify-center text-white/70 text-sm">
              {supported ? 'Tap "Start camera" to begin' : 'Camera disabled'}
            </div>
          )}
          {active && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-x-8 top-1/2 -translate-y-1/2 h-32 border-2 border-indigo-400 rounded overflow-hidden">
                <div className="chem-scan-laser" aria-hidden />
              </div>
              <style>{`
                .chem-scan-laser {
                  position: absolute;
                  left: 0;
                  right: 0;
                  height: 2px;
                  background: linear-gradient(90deg, transparent, rgba(239, 68, 68, 0.95), transparent);
                  box-shadow: 0 0 8px 2px rgba(239, 68, 68, 0.7), 0 0 18px 6px rgba(239, 68, 68, 0.35);
                  animation: chem-scan-sweep 1.6s ease-in-out infinite alternate;
                  will-change: top;
                }
                @keyframes chem-scan-sweep {
                  from { top: 0; }
                  to   { top: calc(100% - 2px); }
                }
                @media (prefers-reduced-motion: reduce) {
                  .chem-scan-laser { animation: none; top: 50%; }
                }
              `}</style>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          {active ? (
            <button
              onClick={stopCamera}
              className="px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700"
            >Stop camera</button>
          ) : (
            <button
              onClick={() => void startCamera()}
              disabled={!supported}
              className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
            >
              <ScanLine className="w-4 h-4" /> Start camera
            </button>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-2">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Manual entry</h2>
        <form
          onSubmit={e => {
            e.preventDefault()
            if (code.trim()) void resolve(code.trim())
          }}
          className="flex flex-wrap gap-2"
        >
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder="CHEM-0042-2026-0007"
            className="flex-1 min-w-[200px] px-3 py-2 text-sm rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-60"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Look up
          </button>
        </form>
      </section>
    </div>
  )
}
