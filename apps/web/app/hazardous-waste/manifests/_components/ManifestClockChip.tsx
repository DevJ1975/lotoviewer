import { MANIFEST_STAGE_TONE, clockChipText, type ManifestListItem } from '@/lib/hazardousWasteManifestView'

// "Day 36 of 45 · Follow up now": the stage in words as well as colour, with the rule it follows
// in the tooltip for anyone hovering. The full note is on the manifest's own page.

export function ManifestClockChip({ item }: { item: Pick<ManifestListItem, 'clock' | 'generator_category' | 'jurisdiction'> }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${MANIFEST_STAGE_TONE[item.clock.stage]}`}
      title={item.clock.note}
    >
      {clockChipText(item)}
    </span>
  )
}
