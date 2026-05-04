import { ImageResponse } from 'next/og'

// Standard 32×32 favicon. Next.js auto-serves this at /icon and emits the
// matching <link rel="icon"> in <head>, replacing the legacy favicon.ico.
export const size        = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width:           '100%',
          height:          '100%',
          background:      '#1B3A6B',
          color:           '#FFD900',
          fontSize:        18,
          fontWeight:      900,
          letterSpacing:   '-0.05em',
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
