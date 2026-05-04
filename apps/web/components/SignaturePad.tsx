'use client'

import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react'

export interface SignaturePadRef {
  isEmpty:    () => boolean
  clear:      () => void
  toDataURL:  () => string
}

interface Props {
  onChange?: (isEmpty: boolean) => void
}

const SignaturePad = forwardRef<SignaturePadRef, Props>(function SignaturePad({ onChange }, ref) {
  const canvasRef  = useRef<HTMLCanvasElement>(null)
  const drawing    = useRef(false)
  const hasDrawn   = useRef(false)

  // Ref the prop callback so all drawing handlers stay stable — re-binding
  // mouse/touch listeners on every parent render is expensive and error-prone.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // Bind exactly once per canvas mount.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function getCtx() {
      const c = canvas!.getContext('2d')
      if (!c) return null
      c.strokeStyle = '#1B3A6B'
      c.lineWidth   = 2
      c.lineCap     = 'round'
      c.lineJoin    = 'round'
      return c
    }

    function relPos(e: { clientX: number; clientY: number }) {
      const r = canvas!.getBoundingClientRect()
      return {
        x: (e.clientX - r.left) * (canvas!.width  / r.width),
        y: (e.clientY - r.top)  * (canvas!.height / r.height),
      }
    }

    function onMouseDown(e: MouseEvent) {
      const ctx = getCtx(); if (!ctx) return
      drawing.current = true
      const p = relPos(e)
      ctx.beginPath(); ctx.moveTo(p.x, p.y)
    }

    function onMouseMove(e: MouseEvent) {
      if (!drawing.current) return
      const ctx = getCtx(); if (!ctx) return
      const p = relPos(e)
      ctx.lineTo(p.x, p.y); ctx.stroke()
      if (!hasDrawn.current) { hasDrawn.current = true; onChangeRef.current?.(false) }
    }

    function onMouseUp() { drawing.current = false }

    function onTouchStart(e: TouchEvent) {
      e.preventDefault()
      const ctx = getCtx(); if (!ctx) return
      drawing.current = true
      const p = relPos(e.touches[0])
      ctx.beginPath(); ctx.moveTo(p.x, p.y)
    }

    function onTouchMove(e: TouchEvent) {
      e.preventDefault()
      if (!drawing.current) return
      const ctx = getCtx(); if (!ctx) return
      const p = relPos(e.touches[0])
      ctx.lineTo(p.x, p.y); ctx.stroke()
      if (!hasDrawn.current) { hasDrawn.current = true; onChangeRef.current?.(false) }
    }

    canvas.addEventListener('mousedown',  onMouseDown)
    canvas.addEventListener('mousemove',  onMouseMove)
    canvas.addEventListener('mouseup',    onMouseUp)
    canvas.addEventListener('mouseleave', onMouseUp)
    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false })
    canvas.addEventListener('touchend',   onMouseUp)
    return () => {
      canvas.removeEventListener('mousedown',  onMouseDown)
      canvas.removeEventListener('mousemove',  onMouseMove)
      canvas.removeEventListener('mouseup',    onMouseUp)
      canvas.removeEventListener('mouseleave', onMouseUp)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove',  onTouchMove)
      canvas.removeEventListener('touchend',   onMouseUp)
    }
  }, [])

  useImperativeHandle(ref, () => ({
    isEmpty:   () => !hasDrawn.current,
    toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? '',
    clear: () => {
      const canvas = canvasRef.current; if (!canvas) return
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
      hasDrawn.current = false
      onChangeRef.current?.(true)
    },
  }))

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={160}
      className="w-full h-[140px] rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 cursor-crosshair touch-none select-none"
    />
  )
})

export default SignaturePad
