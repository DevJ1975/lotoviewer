import { ImageResponse } from 'next/og'

// Next.js auto-serves this file at /apple-icon and emits the matching
// <link rel="apple-touch-icon"> in <head>. Rendered as a real PNG by the
// built-in OG image runtime so iOS gets the higher-fidelity raster it
// prefers over the SVG.
//
// Apple recommends 180×180 for iOS home-screen icons; iPadOS scales down.
export const size        = { width: 180, height: 180 }
export const contentType = 'image/png'
// Don't add a runtime export — let Next pick the default for the version.

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:           '100%',
          height:          '100%',
          background:      '#1B3A6B',
          color:           '#FFD900',
          fontSize:        96,
          fontWeight:      900,
          letterSpacing:   '-0.04em',
          fontFamily:      'sans-serif',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
        }}
      >
        SL
      </div>
    ),
    size,
  )
}
