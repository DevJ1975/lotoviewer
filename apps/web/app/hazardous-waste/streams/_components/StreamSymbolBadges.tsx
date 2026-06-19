import { PictogramBadges, SignalWordBadge } from '@/app/chemicals/_components/PictogramBadges'
import { Nfpa704Diamond } from '@/app/chemicals/_components/Nfpa704Diamond'
import { PlacardBadges } from '@/app/chemicals/_components/PlacardBadges'

// Read-only hazard-symbol row for a waste stream. Reuses the chemical-module
// badge components verbatim so streams and products render identically. The
// `source` shape matches the raw stream row (nullable strings/arrays from the
// API) — the badge components own their own empty/unknown-value fallbacks.

// The GHS + DOT subset the compact badge row reads. Kept separate from the
// full source so list/container views can pass a stream join that omits the
// NFPA columns the diamond needs.
export interface StreamBadgeSource {
  ghs_pictograms:    string[] | null
  ghs_signal_word:   string | null
  dot_un_number:     string | null
  dot_hazard_class:  string | null
  dot_packing_group: string | null
}

export interface StreamSymbolSource extends StreamBadgeSource {
  nfpa_health:       number | null
  nfpa_flammability: number | null
  nfpa_instability:  number | null
  nfpa_special:      string | null
}

function hasNfpa(s: StreamSymbolSource): boolean {
  return s.nfpa_health !== null
    || s.nfpa_flammability !== null
    || s.nfpa_instability !== null
    || (s.nfpa_special?.trim().length ?? 0) > 0
}

interface Props {
  source: StreamBadgeSource
  /** 'sm' for list rows, 'md'/'lg' for detail. Defaults to 'sm'. */
  size?:  'sm' | 'md' | 'lg'
}

/** Compact inline badges for list/card rows: GHS + signal word + DOT placard. */
export function StreamSymbolBadges({ source, size = 'sm' }: Props) {
  const pictograms = source.ghs_pictograms ?? []
  const hasGhs = pictograms.length > 0
  const hasDot = !!source.dot_hazard_class

  if (!hasGhs && !hasDot && !source.ghs_signal_word) return null

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <SignalWordBadge word={source.ghs_signal_word} />
      {hasGhs && <PictogramBadges pictograms={pictograms} size={size} />}
      {hasDot && (
        <PlacardBadges
          hazardClass={source.dot_hazard_class}
          unNumber={source.dot_un_number}
          packingGroup={source.dot_packing_group}
          size={size}
        />
      )}
    </span>
  )
}

/** Full detail layout: NFPA diamond beside the GHS/DOT badge row. */
export function StreamSymbolDetail({ source }: { source: StreamSymbolSource }) {
  const pictograms = source.ghs_pictograms ?? []
  const showNfpa = hasNfpa(source)
  const showAnything = pictograms.length > 0 || !!source.ghs_signal_word
    || !!source.dot_hazard_class || showNfpa

  if (!showAnything) {
    return <p className="text-sm italic text-slate-400">No hazard symbols recorded for this stream.</p>
  }

  return (
    <div className="flex flex-wrap items-start gap-6">
      {(pictograms.length > 0 || source.ghs_signal_word) && (
        <div className="space-y-2">
          <SignalWordBadge word={source.ghs_signal_word} />
          <PictogramBadges pictograms={pictograms} size="md" showLabel />
        </div>
      )}
      {showNfpa && (
        <Nfpa704Diamond
          health={source.nfpa_health}
          flammability={source.nfpa_flammability}
          instability={source.nfpa_instability}
          special={source.nfpa_special}
          size="md"
        />
      )}
      {source.dot_hazard_class && (
        <PlacardBadges
          hazardClass={source.dot_hazard_class}
          unNumber={source.dot_un_number}
          packingGroup={source.dot_packing_group}
          size="md"
          showLabel
        />
      )}
    </div>
  )
}
