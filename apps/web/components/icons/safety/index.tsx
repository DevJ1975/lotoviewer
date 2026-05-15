// Custom duotone safety pictograms. Drawn in the same visual language
// as ISO-7010 / ANSI safety signs: clear silhouettes, no fine detail,
// readable at 16px. Pair with `text-{color}-700` / `dark:text-{color}-300`
// on a parent so the silhouette inherits the active module color, and
// the duotone "fill" layer renders at fill-opacity ~0.2.
//
// Each component accepts `className` and forwards it onto the root <svg>.
// Stroke uses `currentColor`; the soft fill also uses `currentColor` at
// a lower opacity so a single text-color cascade theme-tints the whole
// pictogram — works with light + dark + the per-module accent colors
// declared in moduleVisuals.ts.
//
// Why inline SVGs rather than an icon package? Three reasons:
//   1. No new dependency / lockfile churn.
//   2. We control the visual vocabulary — these read as real safety
//      signage, not generic "duotone-pretty" icons.
//   3. ~24 lines each, tree-shakable, zero runtime cost.

import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { className?: string }

const baseProps: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  xmlns: 'http://www.w3.org/2000/svg',
  'aria-hidden': true,
  focusable: false,
}

// LOTO — padlock body with hasp + small chain loop. Duotone fill on the
// padlock body; hasp + chain are strokes.
export function PadlockIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M7 11.5h10v8H7z" fill="currentColor" fillOpacity="0.18" />
      <path d="M7 11.5h10a0.5 0.5 0 0 1 0.5 0.5v7a0.5 0.5 0 0 1-0.5 0.5H7a0.5 0.5 0 0 1-0.5-0.5v-7a0.5 0.5 0 0 1 0.5-0.5Z" />
      <path d="M9 11.5V8.25a3 3 0 0 1 6 0V11.5" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" />
      <path d="M12 16.2v1.6" />
    </svg>
  )
}

// Hot work — flame inside a warning triangle (ISO W021-style).
export function FlameTriangleIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3.5 21 20H3z" fill="currentColor" fillOpacity="0.18" />
      <path d="M12 3.5 21 20H3z" />
      <path
        d="M12 9.5c0.6 1.2 1.6 1.8 1.6 3.2 0 1.4-1.1 2.3-1.6 2.3-0.5 0-1.6-0.6-1.6-2 0-1 0.8-1.5 0.6-2.4-0.2-0.7-0.6-1-0.6-1.6 0-0.8 0.7-1.3 1.6 0.5Z"
        fill="currentColor"
        fillOpacity="0.55"
        stroke="none"
      />
    </svg>
  )
}

// Hazmat — biohazard trefoil, simplified for 24px legibility.
export function BiohazardIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <circle cx="12" cy="12" r="2.2" fill="currentColor" fillOpacity="0.25" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M9.5 9c-2.4 0.4-3.5 2.6-3.5 4M6 16c1.2 1.4 3.3 1.6 4.5 0.8" fill="none" />
      <path d="M14.5 9c2.4 0.4 3.5 2.6 3.5 4M18 16c-1.2 1.4-3.3 1.6-4.5 0.8" fill="none" />
      <path d="M10.5 13.5c-0.4 1.6-1.6 2.5-2.6 2.6M13.5 13.5c0.4 1.6 1.6 2.5 2.6 2.6M12 9.8V6.5" fill="none" />
      <circle cx="6" cy="16.5" r="0.9" fill="currentColor" />
      <circle cx="18" cy="16.5" r="0.9" fill="currentColor" />
      <circle cx="12" cy="5.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

// Confined space — manhole opening with a worker silhouette descending.
export function ManholeIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <ellipse cx="12" cy="18" rx="8" ry="2.2" fill="currentColor" fillOpacity="0.2" />
      <ellipse cx="12" cy="18" rx="8" ry="2.2" />
      <ellipse cx="12" cy="18" rx="5" ry="1.2" fill="currentColor" fillOpacity="0.35" />
      <circle cx="12" cy="6.5" r="1.6" fill="currentColor" fillOpacity="0.6" stroke="none" />
      <path d="M12 8.4v4.6M10 11h4M11 13l-1.5 3.5M13 13l1.5 3.5" />
    </svg>
  )
}

// Risk / general hazard — diamond placard with exclamation, like an
// ANSI/DOT hazard sign.
export function HazardDiamondIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M12 3.2 20.8 12 12 20.8 3.2 12z" fill="currentColor" fillOpacity="0.18" />
      <path d="M12 3.2 20.8 12 12 20.8 3.2 12z" />
      <path d="M12 8v5" />
      <circle cx="12" cy="15.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  )
}

// PPE / workers — hard hat profile.
export function HardHatIcon({ className, ...rest }: IconProps) {
  return (
    <svg {...baseProps} className={className} {...rest}>
      <path d="M4 16.5h16v2H4z" fill="currentColor" fillOpacity="0.25" />
      <path d="M4 16.5h16a0.5 0.5 0 0 1 0.5 0.5v1.5a0.5 0.5 0 0 1-0.5 0.5H4a0.5 0.5 0 0 1-0.5-0.5V17a0.5 0.5 0 0 1 0.5-0.5Z" />
      <path
        d="M6 16.5v-2.2C6 10.6 8.7 7.5 12 7.5s6 3.1 6 6.8v2.2"
        fill="currentColor"
        fillOpacity="0.18"
      />
      <path d="M6 16.5v-2.2C6 10.6 8.7 7.5 12 7.5s6 3.1 6 6.8v2.2" />
      <path d="M12 7.5V5.5M10 7.7v-1M14 7.7v-1" />
    </svg>
  )
}
