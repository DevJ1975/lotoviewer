// Server component (no "use client") — emits the apple-touch-startup-image
// link tags that iOS Safari requires for standalone PWAs to show a branded
// splash on launch instead of a blank white screen.
//
// Each link must match a specific device dimension + DPR. Apple's matrix is
// noisy; we cover current iPhones (X-series and newer) and the iPad sizes
// most likely to be used in the field. Older devices fall back gracefully —
// they just see the white screen they would have seen anyway.

interface Variant {
  device: string
  width:  number   // CSS pixels
  height: number   // CSS pixels
  dpr:    number
}

const VARIANTS: Variant[] = [
  // iPhone Pro Max / Plus
  { device: 'iPhone 14/15/16 Pro Max', width: 430,  height: 932,  dpr: 3 },
  { device: 'iPhone 14/15 Plus',        width: 428,  height: 926,  dpr: 3 },
  // iPhone Pro
  { device: 'iPhone 15/16 Pro',         width: 393,  height: 852,  dpr: 3 },
  { device: 'iPhone 14/15',             width: 390,  height: 844,  dpr: 3 },
  { device: 'iPhone 12/13 mini',        width: 375,  height: 812,  dpr: 3 },
  // Older iPhones still in the field
  { device: 'iPhone XR / 11',           width: 414,  height: 896,  dpr: 2 },
  { device: 'iPhone X / XS / 11 Pro',   width: 375,  height: 812,  dpr: 3 },
  { device: 'iPhone SE 2/3',            width: 375,  height: 667,  dpr: 2 },
  // iPad — most likely platform for LOTO field use
  { device: 'iPad Mini (6th gen)',      width: 744,  height: 1133, dpr: 2 },
  { device: 'iPad 10.2"',               width: 810,  height: 1080, dpr: 2 },
  { device: 'iPad 10.9"',               width: 820,  height: 1180, dpr: 2 },
  { device: 'iPad Pro 11"',             width: 834,  height: 1194, dpr: 2 },
  { device: 'iPad Pro 12.9"',           width: 1024, height: 1366, dpr: 2 },
  { device: 'iPad Pro 13" (M4)',        width: 1032, height: 1376, dpr: 2 },
]

function link(v: Variant, orientation: 'portrait' | 'landscape') {
  const w = orientation === 'portrait' ? v.width  * v.dpr : v.height * v.dpr
  const h = orientation === 'portrait' ? v.height * v.dpr : v.width  * v.dpr
  const cssW = orientation === 'portrait' ? v.width  : v.height
  const cssH = orientation === 'portrait' ? v.height : v.width
  const media =
    `(device-width: ${cssW}px) and (device-height: ${cssH}px) `
    + `and (-webkit-device-pixel-ratio: ${v.dpr}) `
    + `and (orientation: ${orientation})`
  return (
    <link
      key={`${v.device}-${orientation}`}
      rel="apple-touch-startup-image"
      href={`/splash/${w}x${h}`}
      media={media}
    />
  )
}

export default function IosSplashLinks() {
  return (
    <>
      {VARIANTS.map(v => link(v, 'portrait'))}
      {VARIANTS.map(v => link(v, 'landscape'))}
    </>
  )
}
