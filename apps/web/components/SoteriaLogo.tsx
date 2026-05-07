import Image from 'next/image'

// Brand logo component — single source of truth for the SoteriaField
// wordmark across the app. Picks the right SVG variant based on the
// surface colour:
//
//   color  — cream "Soteria" + teal "Field" + cream mark.  Use on
//            DARK/NAVY backdrops only. Cream on white = invisible;
//            teal-on-white = 2.49:1 (fails WCAG AA). devjr-verified
//            against #1B3A6B navy: cream 9.57:1 (AAA) + teal 4.53:1
//            (AAA Large).
//   dark   — black "Soteria" + grey "Field" + black mark + teal dot.
//            Use on WHITE / LIGHT-CREAM surfaces (in-app chrome,
//            email body cards, light-theme PDFs). Black 17.85:1,
//            grey 4.83:1 — both AA on white.
//   mono   — all-cream mark + wordmark. Use on DARK or PHOTOGRAPHIC
//            backdrops where the teal accent would clash.
//
// Contrast guard-rail: passing variant='color' onto a light surface
// produces a WCAG failure. Pick the variant that matches the
// background; when in doubt, use 'dark' on light, 'color' or 'mono'
// on dark.
//
// SVG-only — no image processing, no font loading. Width is
// configurable via the `width` prop; height auto-scales by the SVG's
// 1400×320 viewBox aspect ratio (~4.375:1).

export type SoteriaLogoVariant = 'color' | 'dark' | 'mono'

interface Props {
  variant?: SoteriaLogoVariant
  /** Pixel width. Height auto-scales to preserve aspect ratio. */
  width?:   number
  className?: string
  priority?: boolean
}

const SRC: Record<SoteriaLogoVariant, string> = {
  color: '/brand/logo-color.svg',
  dark:  '/brand/logo-dark.svg',
  mono:  '/brand/logo-mono-cream.svg',
}

export default function SoteriaLogo({
  variant = 'color',
  width   = 240,
  className,
  priority,
}: Props) {
  // 1400×320 viewBox → height = width * (320/1400) ≈ 0.229 × width.
  const height = Math.round(width * (320 / 1400))
  return (
    <Image
      src={SRC[variant]}
      alt="SoteriaField"
      width={width}
      height={height}
      className={className}
      priority={priority}
    />
  )
}
