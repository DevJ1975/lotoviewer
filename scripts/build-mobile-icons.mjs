#!/usr/bin/env node
// Renders the SoteriaField reticle mark (the same geometry as
// apps/web/app/icon.svg) into the Expo app's icon, adaptive icon, splash and
// favicon PNGs under apps/mobile/assets/images.
//
// Run after changing the brand mark:  npm run build:mobile-icons
//
// Why generated: the Expo template shipped placeholder art, and Apple rejects
// builds that use it. Keeping the geometry in one script means the store icon
// can't drift from the web favicon.
//
// Apple requirements baked in below: the 1024px store icon is a full-bleed
// square with NO alpha channel and no pre-rounded corners (iOS rounds it).

import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '../apps/mobile/assets/images')

const NAVY = '#1B3A6B'
const TEAL = '#14B8A6'

// The mark on a 64-unit grid, scaled about the centre. `scale` < 1 pulls it
// into the Android adaptive-icon safe zone.
function reticle(scale = 1) {
  return `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    <g stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" opacity="0.85">
      <line x1="32" y1="6"  x2="32" y2="18"/>
      <line x1="32" y1="46" x2="32" y2="58"/>
      <line x1="6"  y1="32" x2="18" y2="32"/>
      <line x1="46" y1="32" x2="58" y2="32"/>
    </g>
    <rect x="14" y="14" width="36" height="36" rx="4" fill="none" stroke="#FFFFFF" stroke-width="2.5"/>
    <g stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" fill="none">
      <path d="M 18 22 V 18 H 22"/>
      <path d="M 42 18 H 46 V 22"/>
      <path d="M 46 42 V 46 H 42"/>
      <path d="M 22 46 H 18 V 42"/>
    </g>
    <circle cx="32" cy="32" r="3.5" fill="${TEAL}"/>
  </g>`
}

function svg(body) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${body}</svg>`)
}

const assets = [
  {
    // iOS store icon + Expo `icon`: opaque, full-bleed.
    file: 'icon.png', size: 1024, opaque: true,
    body: `<rect width="64" height="64" fill="${NAVY}"/>${reticle(1)}`,
  },
  {
    // Android adaptive foreground: transparent, mark inside the ~66% safe zone.
    // app.json supplies the navy background colour.
    file: 'adaptive-icon.png', size: 1024, opaque: false,
    body: reticle(0.7),
  },
  {
    // Splash: transparent mark; app.json supplies the navy background.
    file: 'splash-icon.png', size: 1024, opaque: false,
    body: reticle(0.9),
  },
  {
    file: 'favicon.png', size: 48, opaque: false,
    body: `<rect width="64" height="64" rx="10" fill="${NAVY}"/>${reticle(1)}`,
  },
]

mkdirSync(outDir, { recursive: true })

for (const { file, size, opaque, body } of assets) {
  let image = sharp(svg(body), { density: 72 * (size / 64) }).resize(size, size)
  if (opaque) image = image.flatten({ background: NAVY }).removeAlpha()
  await image.png().toFile(resolve(outDir, file))
  console.log(`[mobile-icons] ${file} (${size}px${opaque ? ', opaque' : ''})`)
}
