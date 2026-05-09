import Image from 'next/image'
import { GHS_PICTOGRAM_LABEL, type GhsPictogram } from '@soteria/core/chemicals'

// GHS pictogram badge row. SVGs live at /public/ghs/<code>.svg —
// canonical UN GHS designs (red diamond border + black symbol on
// white) hand-built so the column reads correctly in printed permits
// and SDS bundles. Replace any of the 9 files with a higher-fidelity
// render (e.g. the AdobeStock artwork) without touching this file —
// the component just looks up the path by code.
//
// If the code isn't in the canonical 9 we fall back to a text chip so
// future hazard codes (custom tenant stuff, GHSXX placeholders) still
// render.

const SIZES = {
  sm: { box: 'h-7 w-7', icon: 28, label: 'text-[10px]' },
  md: { box: 'h-10 w-10', icon: 40, label: 'text-xs' },
  lg: { box: 'h-14 w-14', icon: 56, label: 'text-sm' },
} as const

interface Props {
  pictograms: string[]
  size?:      keyof typeof SIZES
  showLabel?: boolean
}

const KNOWN: ReadonlySet<string> = new Set(Object.keys(GHS_PICTOGRAM_LABEL))

export function PictogramBadges({ pictograms, size = 'sm', showLabel = false }: Props) {
  if (!pictograms || pictograms.length === 0) {
    return <span className="text-xs text-slate-400 italic">no GHS hazards</span>
  }
  const s = SIZES[size]
  return (
    <span className="inline-flex flex-wrap items-start gap-2">
      {pictograms.map(code => {
        const label = GHS_PICTOGRAM_LABEL[code as GhsPictogram] ?? code
        const known = KNOWN.has(code)
        return (
          <span key={code} className="inline-flex flex-col items-center gap-0.5" title={label}>
            {known ? (
              <Image
                src={`/ghs/${code}.svg`}
                alt={label}
                width={s.icon}
                height={s.icon}
                className={`${s.box} shrink-0`}
                unoptimized
              />
            ) : (
              <span className={`${s.box} inline-flex items-center justify-center rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 text-[10px] font-mono font-bold`}>
                {code}
              </span>
            )}
            {showLabel && (
              <span className={`${s.label} text-slate-600 dark:text-slate-300 text-center max-w-[5rem] leading-tight`}>
                {label}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

interface SignalProps { word: string | null | undefined }
export function SignalWordBadge({ word }: SignalProps) {
  if (!word) return null
  const cls = word === 'danger'
    ? 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300 border-red-300'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border-amber-300'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold uppercase rounded border ${cls}`}>
      {word}
    </span>
  )
}
