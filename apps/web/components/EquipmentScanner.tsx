'use client'

import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, ScanLine, AlertTriangle, KeyboardIcon } from 'lucide-react'
import { supabase, ACTIVE_TENANT_KEY } from '@/lib/supabase'

// Camera-based equipment scanner. Two paths:
//
//   1. QR primary: BarcodeDetector reads the QR token on the placard,
//      we resolve it via /api/assistant/lookup-by-qr.
//
//   2. Photo fallback: when no QR is visible (or BarcodeDetector isn't
//      supported on the device), the user taps "Snap nameplate". We
//      capture the current frame, POST it to /api/assistant/scan-photo,
//      and Claude vision extracts the equipment_id + candidates.
//
// Manual entry is always available as a third path so workers without a
// labeled placard or a working camera aren't blocked.
//
// We don't ship the @zxing/browser fallback in PR3 — BarcodeDetector
// covers Chromium-based Android (~70% of mobile field devices) and
// Safari iOS gets photo fallback. zxing can land in PR3.5 if iPhone
// QR usage matters more than the dep weight.

export interface ScanResult {
  source: 'qr' | 'photo' | 'manual'
  equipment_id: string
  /** Internal UUID, present when the resolution was unambiguous. */
  id?:          string
  description?: string | null
  department?:  string | null
  /** Filled when source='photo' and confirmation is needed. */
  candidates?:  Array<{ id: string; equipment_id: string; description: string | null; department: string | null }>
  extraction?:  {
    equipment_id: string | null
    confidence:   'high' | 'medium' | 'low'
    notes:        string
  }
}

interface Props {
  onResult: (r: ScanResult) => void
  onCancel?: () => void
}

function readActiveTenant(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(ACTIVE_TENANT_KEY) }
  catch { return null }
}

export default function EquipmentScanner({ onResult, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const detectorRef = useRef<BarcodeDetectorLike | null>(null)
  const scanLoopRef = useRef<number | null>(null)
  const [supportsDetector, setSupportsDetector] = useState<boolean | null>(null)
  const [error,    setError]     = useState<string | null>(null)
  const [busy,     setBusy]      = useState(false)
  const [permState, setPermState] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle')
  const [manualMode, setManualMode] = useState(false)
  const [manualValue, setManualValue] = useState('')

  useEffect(() => {
    // BarcodeDetector availability is a feature-detection on the
    // global. Safari has it behind a flag; Chrome ships it.
    const Det = (typeof window !== 'undefined'
      ? (window as { BarcodeDetector?: { new (opts: { formats: string[] }): BarcodeDetectorLike } }).BarcodeDetector
      : undefined)
    setSupportsDetector(!!Det)
    if (Det) {
      try { detectorRef.current = new Det({ formats: ['qr_code'] }) }
      catch { detectorRef.current = null }
    }
    return stopScan
  }, [])

  async function startCamera() {
    setError(null); setPermState('requesting')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPermState('granted')
      if (detectorRef.current) startQrLoop()
    } catch (err) {
      setPermState('denied')
      setError(err instanceof Error
        ? `Camera unavailable: ${err.message}`
        : 'Camera unavailable.')
    }
  }

  function stopScan() {
    if (scanLoopRef.current) {
      cancelAnimationFrame(scanLoopRef.current)
      scanLoopRef.current = null
    }
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }

  function startQrLoop() {
    const detect = async () => {
      if (!detectorRef.current || !videoRef.current || !videoRef.current.srcObject) return
      try {
        const codes = await detectorRef.current.detect(videoRef.current)
        if (codes.length > 0) {
          const value = codes[0].rawValue.trim()
          await handleQrToken(value)
          return
        }
      } catch {
        // ignore single-frame failures; keep scanning
      }
      scanLoopRef.current = requestAnimationFrame(detect)
    }
    scanLoopRef.current = requestAnimationFrame(detect)
  }

  async function handleQrToken(raw: string) {
    // Accept either the bare token (16 hex) or a URL ending in /scan?token=…
    const token = (() => {
      try {
        const u = new URL(raw)
        return u.searchParams.get('token') ?? raw
      } catch { return raw }
    })()
    if (!/^[0-9a-f]{16}$/i.test(token)) {
      setError(`Scanned QR doesn't look like a Soteria token (got "${raw.slice(0, 40)}").`)
      return
    }
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const access = session?.access_token
      const tenantId = readActiveTenant()
      if (!access)  throw new Error('Sign in expired — please log in again.')
      if (!tenantId) throw new Error('No active tenant — pick one from the header switcher.')

      const res = await fetch(`/api/assistant/lookup-by-qr?token=${encodeURIComponent(token)}`, {
        headers: { authorization: `Bearer ${access}`, 'x-active-tenant': tenantId },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Lookup failed (${res.status})`)
      stopScan()
      onResult({ source: 'qr', ...j.equipment })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setBusy(false)
    }
  }

  async function captureAndExtract() {
    if (!videoRef.current || !streamRef.current) {
      setError('Start the camera first.'); return
    }
    setBusy(true); setError(null)
    try {
      const v = videoRef.current
      const canvas = document.createElement('canvas')
      canvas.width  = v.videoWidth  || 1280
      canvas.height = v.videoHeight || 720
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas not supported.')
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height)
      const blob = await new Promise<Blob | null>(resolve =>
        canvas.toBlob(b => resolve(b), 'image/jpeg', 0.85),
      )
      if (!blob) throw new Error('Capture failed.')

      const { data: { session } } = await supabase.auth.getSession()
      const access = session?.access_token
      const tenantId = readActiveTenant()
      if (!access)  throw new Error('Sign in expired.')
      if (!tenantId) throw new Error('No active tenant.')

      const fd = new FormData()
      fd.set('image', new File([blob], 'nameplate.jpg', { type: 'image/jpeg' }))
      const res = await fetch('/api/assistant/scan-photo', {
        method: 'POST',
        headers: { authorization: `Bearer ${access}`, 'x-active-tenant': tenantId },
        body: fd,
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Vision call failed (${res.status})`)

      stopScan()
      const ext = j.extraction
      const cands = j.candidates ?? []
      if (cands.length === 1) {
        // Unambiguous match — go straight to result.
        onResult({
          source:       'photo',
          equipment_id: cands[0].equipment_id,
          id:           cands[0].id,
          description:  cands[0].description,
          department:   cands[0].department,
          extraction:   ext,
        })
      } else {
        onResult({
          source:       'photo',
          equipment_id: ext?.equipment_id ?? '',
          candidates:   cands,
          extraction:   ext,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setBusy(false)
    }
  }

  function submitManual() {
    const id = manualValue.trim()
    if (!id) return
    stopScan()
    onResult({ source: 'manual', equipment_id: id })
  }

  return (
    <div className="flex flex-col gap-3">
      {!manualMode && (
        <>
          <div className="relative bg-black rounded-md overflow-hidden aspect-video">
            <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
            {permState !== 'granted' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center p-4 bg-black/70">
                <Camera className="h-8 w-8 mb-2" />
                <p className="text-sm mb-3">
                  {permState === 'denied'
                    ? 'Camera permission was denied. Allow it in your browser, or use manual entry.'
                    : 'Point the camera at the QR on the placard, or snap a nameplate photo.'}
                </p>
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={permState === 'requesting'}
                  className="px-3 py-1.5 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
                >
                  {permState === 'requesting' ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Start camera'}
                </button>
              </div>
            )}
            {permState === 'granted' && (
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-44 h-44 border-2 border-white/80 rounded-md flex items-center justify-center">
                  <ScanLine className="h-6 w-6 text-white/80" />
                </div>
              </div>
            )}
            {busy && (
              <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-sm">
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Looking up…
              </div>
            )}
          </div>

          {permState === 'granted' && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={captureAndExtract}
                disabled={busy}
                className="flex-1 px-3 py-2 rounded-md bg-slate-800 text-white text-sm hover:bg-slate-700 disabled:opacity-60"
              >
                Snap nameplate
              </button>
              <button
                type="button"
                onClick={() => { stopScan(); setManualMode(true) }}
                className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-sm"
              >
                Manual
              </button>
            </div>
          )}
          {supportsDetector === false && permState === 'granted' && (
            <p className="text-[11px] text-slate-500">
              QR detection isn&apos;t supported on this browser — use Snap nameplate or Manual entry.
            </p>
          )}
        </>
      )}

      {manualMode && (
        <div className="space-y-2">
          <label htmlFor="eq-manual" className="block text-xs font-medium text-slate-700 dark:text-slate-200">Equipment ID</label>
          <input
            id="eq-manual"
            value={manualValue}
            onChange={e => setManualValue(e.target.value)}
            placeholder="e.g. MIX-04"
            className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={submitManual}
              disabled={!manualValue.trim()}
              className="flex-1 px-3 py-2 rounded-md bg-indigo-600 text-white text-sm hover:bg-indigo-700 disabled:opacity-60"
            >
              Look up
            </button>
            <button
              type="button"
              onClick={() => setManualMode(false)}
              className="px-3 py-2 rounded-md border border-slate-300 dark:border-slate-700 text-sm"
            >
              <KeyboardIcon className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 p-2 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-700 dark:text-rose-300">{error}</p>
        </div>
      )}

      {onCancel && (
        <div className="flex justify-end">
          <button onClick={() => { stopScan(); onCancel() }} className="text-xs text-slate-500 hover:text-slate-700">
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement): Promise<Array<{ rawValue: string }>>
}
