// Reusable colored pill for displaying a risk band. Will be used
// throughout the Risk Assessment UI in slices 2-4 (heat map cell,
// list-row badge, detail-page header). Lifted into its own
// component now so callers don't reinvent the color/pattern/label
// pairing — and so any future tweak (different patterns, dark-mode
// adjustments, etc.) lands in one place.
//
// Quality-bar requirement: WCAG AA + color-blind safe. Color is
// always paired with a text label AND a CSS pattern overlay. The
// patterns are defined as Tailwind utility classes via custom
// background-image SVG — see globals.css. If those classes don't
// exist yet (this is the first consumer), the component still
// renders correctly because the label + the high-contrast color
// are sufficient for WCAG AA on their own; the pattern is
// additional belt-and-suspenders for severe color-blindness.

import { cn } from '@/lib/utils'
import { colorFor, type Band } from '@soteria/core/risk'

interface Props {
  band:    Band
  /** Optional score to render alongside the band label. */
  score?:  number | null
  /** Compact rendering (smaller padding, smaller text) for table rows. */
  compact?: boolean
  className?: string
}

export function RiskBandPill({ band, score, compact, className }: Props) {
  const display = colorFor(band)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md font-semibold',
        // Pattern class always present so a color-blind user sees a
        // distinct texture on each band. Defined in globals.css as
        // tiny SVG background-image utilities.
        display.pattern,
        display.tailwind,
        display.textClass,
        compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        className,
      )}
      // Full ARIA text so screen readers don't have to derive
      // meaning from the color alone.
      aria-label={score != null ? `${display.label} risk, score ${score}` : `${display.label} risk`}
    >
      <span aria-hidden>{display.label}</span>
      {score != null && (
        <span aria-hidden className="font-mono opacity-90">{score}</span>
      )}
    </span>
  )
}
