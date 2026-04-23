import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

// Dynamic apple-touch-startup-image generator. iOS standalone PWAs require
// matching splash images per device dimension or they show a blank white
// screen during launch. We render them on-demand from the brand mark so we
// don't ship a dozen static PNGs.
//
// Routes:  /splash/{width}x{height}      → portrait at @1x
//          /splash/{width}x{height}@2x   → @2x raster
//          /splash/{width}x{height}@3x   → @3x raster
// (We always render at the requested pixel size; the @suffix is for the URL
// only — iOS uses the link's media query to pick a match.)

const MAX_DIM = 4096  // sanity cap so we don't get DDoS'd by random sizes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ size: string }> },
) {
  const { size } = await params
  const match = /^(\d+)x(\d+)(?:@\dx)?$/.exec(size)
  if (!match) {
    return new Response('Invalid size', { status: 400 })
  }

  const width  = Math.min(parseInt(match[1], 10), MAX_DIM)
  const height = Math.min(parseInt(match[2], 10), MAX_DIM)
  if (!width || !height) {
    return new Response('Invalid size', { status: 400 })
  }

  // Mark scales with the smaller dimension so it always feels centered.
  const markFontPx = Math.round(Math.min(width, height) * 0.18)
  const markPad    = Math.round(Math.min(width, height) * 0.05)
  const markBox    = Math.round(Math.min(width, height) * 0.30)

  return new ImageResponse(
    (
      <div
        style={{
          width:           '100%',
          height:          '100%',
          background:      '#1B3A6B',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          fontFamily:      'sans-serif',
        }}
      >
        <div
          style={{
            width:           markBox,
            height:          markBox,
            borderRadius:    markBox * 0.18,
            background:      '#FFD900',
            color:           '#1B3A6B',
            display:         'flex',
            alignItems:      'center',
            justifyContent:  'center',
            fontSize:        markFontPx,
            fontWeight:      900,
            letterSpacing:   '-0.04em',
            padding:         markPad,
          }}
        >
          SL
        </div>
      </div>
    ),
    { width, height },
  )
}
