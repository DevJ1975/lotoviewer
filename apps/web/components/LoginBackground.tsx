'use client'

import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'

// Pool of background photos. Picked at random on every mount of the
// login screen so each visit feels distinct. Files live in
// /public/brand/login-bg/ — see that directory for the source jpegs.
const BACKGROUNDS = [
  '/brand/login-bg/worker-1.jpg',
  '/brand/login-bg/worker-2.jpg',
  '/brand/login-bg/worker-3.jpg',
  '/brand/login-bg/worker-4.jpg',
  '/brand/login-bg/worker-5.jpg',
] as const

// Maximum pixel offset for the cursor parallax. Kept small (8px) so
// the motion reads as ambient depth rather than a moving image.
const PARALLAX_RANGE = 8

export default function LoginBackground() {
  // Pick a random index after mount to avoid an SSR/CSR mismatch
  // (server has no way to know which of the 5 images was rolled).
  const [src, setSrc] = useState<string | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const reduceMotion = useRef(false)

  useEffect(() => {
    setSrc(BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)])

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    reduceMotion.current = mq.matches
    const onChange = (e: MediaQueryListEvent) => { reduceMotion.current = e.matches }
    mq.addEventListener('change', onChange)

    function onPointer(e: PointerEvent) {
      if (reduceMotion.current) return
      const nx = (e.clientX / window.innerWidth)  * 2 - 1  // -1..1
      const ny = (e.clientY / window.innerHeight) * 2 - 1
      setOffset({ x: nx * PARALLAX_RANGE, y: ny * PARALLAX_RANGE })
    }
    window.addEventListener('pointermove', onPointer, { passive: true })

    return () => {
      window.removeEventListener('pointermove', onPointer)
      mq.removeEventListener('change', onChange)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#1B3A6B]"
    >
      {src && (
        // Outer layer: pointer-driven parallax offset.
        // Inner layer: slow ambient zoom/drift via CSS keyframes.
        // Two layers because composing both transforms on one node
        // means whichever was set last wins.
        <div
          className="absolute -inset-6 transition-transform duration-300 ease-out will-change-transform"
          style={{ transform: `translate3d(${offset.x}px, ${offset.y}px, 0)` }}
        >
          <div className="absolute inset-0 animate-login-bg-drift">
            <Image
              src={src}
              alt=""
              fill
              priority
              sizes="100vw"
              className="object-cover grayscale"
            />
          </div>
        </div>
      )}
      {/* Navy tint + vignette so the white sign-in card stays legible
          regardless of which photo was rolled. */}
      <div className="absolute inset-0 bg-[#1B3A6B]/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#1B3A6B]/20 via-transparent to-[#1B3A6B]/70" />
    </div>
  )
}
