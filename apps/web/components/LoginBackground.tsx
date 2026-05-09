'use client'

import Image from 'next/image'
import { useEffect, useState } from 'react'

// Pool of background photos. Picked at random on every mount of the
// login screen so each visit feels distinct. Files live in
// /public/brand/login-bg/ — see that directory for the source jpegs.
// (worker-2.jpg is intentionally omitted: the source export is 21 MB
// and would dominate the page weight even after Next/Image resizing.
// Re-add it here once a compressed version replaces the original.)
const BACKGROUNDS = [
  '/brand/login-bg/worker-1.jpg',
  '/brand/login-bg/worker-3.jpg',
  '/brand/login-bg/worker-4.jpg',
  '/brand/login-bg/worker-5.jpg',
] as const

export default function LoginBackground() {
  // Pick a random index after mount to avoid an SSR/CSR mismatch
  // (server has no way to know which of the 5 images was rolled).
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    setSrc(BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)])
  }, [])

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden bg-[#1B3A6B]"
    >
      {src && (
        // Slow ambient pan + zoom via CSS keyframes. No pointer
        // interaction — the motion is fully autonomous.
        <div className="absolute -inset-12 animate-login-bg-drift will-change-transform">
          <Image
            src={src}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover grayscale"
          />
        </div>
      )}
      {/* Navy tint + vignette so the white sign-in card stays legible
          regardless of which photo was rolled. */}
      <div className="absolute inset-0 bg-[#1B3A6B]/55" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#1B3A6B]/20 via-transparent to-[#1B3A6B]/70" />
    </div>
  )
}
