import { GHS_PICTOGRAM_LABEL, type GhsPictogram } from '@soteria/core/chemicals'

// Compact GHS pictogram badge row. We don't ship the regulatory SVGs
// in this commit — they go under public/ghs/ in the labeling phase
// (see plan §5). Until then the badge is a text-coded chip that still
// communicates the hazard class at a glance.

interface Props {
  pictograms: string[]
  size?: 'sm' | 'md'
  showLabel?: boolean
}

export function PictogramBadges({ pictograms, size = 'sm', showLabel = false }: Props) {
  if (!pictograms || pictograms.length === 0) {
    return <span className="text-xs text-slate-400 italic">no GHS hazards</span>
  }
  const cls = size === 'sm'
    ? 'inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono rounded border'
    : 'inline-flex items-center px-2 py-1 text-xs font-mono rounded border'
  return (
    <span className="inline-flex flex-wrap gap-1">
      {pictograms.map(p => {
        const label = GHS_PICTOGRAM_LABEL[p as GhsPictogram] ?? p
        return (
          <span
            key={p}
            title={label}
            className={`${cls} bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300`}
          >
            {p}{showLabel && <span className="ml-1 font-sans">{label}</span>}
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
