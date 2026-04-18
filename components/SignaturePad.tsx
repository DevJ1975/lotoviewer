'use client'

import { useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from 'react'

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

  function getCtx() {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ctx = canvas.getContext('2d')!
    ctx.strokeStyle = '#1B3A6B'
    ctx.lineWidth   = 2
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    return { ctx, canvas }
  }

  function relPos(e: MouseEvent | Touch, canvas: HTMLCanvasElement) {
    const r = canvas.getBoundingClientRect()
    return {
      x: (e.clientX - r.left) * (canvas.width  / r.width),
      y: (e.clientY - r.top)  * (canvas.height / r.height),
    }
  }

  const onMouseDown = useCallback((e: MouseEvent) => {
    const c = getCtx(); if (!c) return
    drawing.current = true
    const p = relPos(e, c.canvas)
    c.ctx.beginPath()
    c.ctx.moveTo(p.x, p.y)
  }, [])

  const onMouseMove = useCallback((e: MouseEvent) => {
    if (!drawing.current) return
    const c = getCtx(); if (!c) return
    const p = relPos(e, c.canvas)
    c.ctx.lineTo(p.x, p.y)
    c.ctx.stroke()
    if (!hasDrawn.current) { hasDrawn.current = true; onChange?.(false) }
  }, [onChange])

  const onMouseUp = useCallback(() => { drawing.current = false }, [])

  const onTouchStart = useCallback((e: TouchEvent) => {
    e.preventDefault()
    const c = getCtx(); if (!c) return
    drawing.current = true
    const p = relPos(e.touches[0], c.canvas)
    c.ctx.beginPath()
    c.ctx.moveTo(p.x, p.y)
  }, [])

  const onTouchMove = useCallback((e: TouchEvent) => {
    e.preventDefault()
    if (!drawing.current) return
    const c = getCtx(); if (!c) return
    const p = relPos(e.touches[0], c.canvas)
    c.ctx.lineTo(p.x, p.y)
    c.ctx.stroke()
    if (!hasDrawn.current) { hasDrawn.current = true; onChange?.(false) }
  }, [onChange])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
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
  }, [onMouseDown, onMouseMove, onMouseUp, onTouchStart, onTouchMove])

  useImperativeHandle(ref, () => ({
    isEmpty:   () => !hasDrawn.current,
    toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? '',
    clear: () => {
      const canvas = canvasRef.current; if (!canvas) return
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height)
      hasDrawn.current = false
      onChange?.(true)
    },
  }))

  return (
    <canvas
      ref={canvasRef}
      width={600}
      height={160}
      className="w-full h-[140px] rounded-lg border-2 border-dashed border-slate-200 bg-white cursor-crosshair touch-none select-none"
    />
  )
})

export default SignaturePad
