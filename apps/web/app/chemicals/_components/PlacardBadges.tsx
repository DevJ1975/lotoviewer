import Image from 'next/image'
import {
  DOT_HAZARD_CLASS_META,
  isValidDotHazardClass,
  type DotHazardClass,
} from '@soteria/core/hazardSymbols'

// DOT / UN transport placard badge. SVGs live at /public/dot/<id>.svg —
// the on-point square placards (orange/red/green/etc. per class, with the
// hazard-class number in the bottom corner). When the class id isn't a
// catalogued DOT class we fall back to a colored chip tinted with the
// class's placardColor so the column still renders for partial data.
//
// Mirrors PictogramBadges: next/image + unoptimized for the SVG, a text
// fallback otherwise, and an optional caption row. The UN number and
// packing group render beneath when supplied (e.g. "UN1993 · PG II").

const SIZES = {
  sm: { box: 'h-7 w-7', icon: 28, label: 'text-[10px]' },
  md: { box: 'h-10 w-10', icon: 40, label: 'text-xs' },
  lg: { box: 'h-14 w-14', icon: 56, label: 'text-sm' },
} as const

interface Props {
  hazardClass:   string | null
  unNumber?:     string | null
  packingGroup?: string | null
  size?:         keyof typeof SIZES
  showLabel?:    boolean
}

// Normalize a UN number to the canonical "UN####" display form. Accepts
// "1993", "UN1993", or "un 1993" and renders "UN1993"; returns null for
// anything that doesn't carry digits.
function formatUnNumber(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  return digits ? `UN${digits}` : null
}

export function PlacardBadges({
  hazardClass,
  unNumber,
  packingGroup,
  size = 'sm',
  showLabel = false,
}: Props) {
  if (!hazardClass) {
    return <span className="text-xs text-slate-400 italic">no DOT class</span>
  }
  const s = SIZES[size]
  const known = isValidDotHazardClass(hazardClass)
  const meta = known ? DOT_HAZARD_CLASS_META[hazardClass as DotHazardClass] : null
  const labelName = meta?.labelName ?? `Class ${hazardClass}`

  const un = formatUnNumber(unNumber)
  const pg = packingGroup?.trim() ? `PG ${packingGroup.trim()}` : null
  const caption = [un, pg].filter(Boolean).join(' · ')

  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={labelName}>
      {meta ? (
        <Image
          src={meta.imagePath}
          alt={labelName}
          width={s.icon}
          height={s.icon}
          className={`${s.box} shrink-0`}
          unoptimized
        />
      ) : (
        // Unknown class id: a neutral chip carrying the raw class text so a
        // stale or custom value still renders rather than disappearing.
        <span
          className={`${s.box} inline-flex items-center justify-center rounded border border-slate-400 bg-slate-200 dark:bg-slate-700 text-[10px] font-mono font-bold text-slate-900 dark:text-slate-100`}
        >
          {hazardClass}
        </span>
      )}
      {showLabel && (
        <span className={`${s.label} text-slate-600 dark:text-slate-300 text-center max-w-[5rem] leading-tight`}>
          {labelName}
        </span>
      )}
      {caption && (
        <span className={`${s.label} font-mono text-slate-500 dark:text-slate-400 text-center leading-tight`}>
          {caption}
        </span>
      )}
    </span>
  )
}
