import { ImageResponse } from 'next/og'

// Next.js auto-serves this file at /apple-icon and emits the matching
// <link rel="apple-touch-icon"> in <head>. Rendered as a real PNG by the
// built-in OG image runtime so iOS gets the higher-fidelity raster it
// prefers over the SVG.
//
// Apple recommends 180×180 for iOS home-screen icons; iPadOS scales down.
// The square is full-bleed: iOS applies its own corner mask, so pre-rounded
// corners would show as a dark halo.
export const size        = { width: 180, height: 180 }
export const contentType = 'image/png'
// Don't add a runtime export — let Next pick the default for the version.

// Same reticle geometry as app/icon.svg and public/icons/icon-192.svg
// (64-unit grid). Keep in step with scripts/build-brand-icons.mjs.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', background: '#1B3A6B' }}>
        <svg width="180" height="180" viewBox="0 0 64 64" fill="none">
          <g stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.85">
            <line x1="32" y1="6" x2="32" y2="18" />
            <line x1="32" y1="46" x2="32" y2="58" />
            <line x1="6" y1="32" x2="18" y2="32" />
            <line x1="46" y1="32" x2="58" y2="32" />
          </g>
          <rect x="14" y="14" width="36" height="36" rx="4" stroke="#FFFFFF" strokeWidth="2.5" />
          <g stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round">
            <path d="M 18 22 V 18 H 22" />
            <path d="M 42 18 H 46 V 22" />
            <path d="M 46 42 V 46 H 42" />
            <path d="M 22 46 H 18 V 42" />
          </g>
          <circle cx="32" cy="32" r="3.5" fill="#14B8A6" />
        </svg>
      </div>
    ),
    size,
  )
}
