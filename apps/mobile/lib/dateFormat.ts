// Shared date formatters for mobile detail screens.
//
// Three detail pages (Near-Miss, JHA, Risk) had near-identical
// `fmt(iso)` helpers — extracting here so a future format tweak only
// lands in one place. JHA + Risk show month/day; Near-Miss also shows
// time-of-day because the triage UX cares about "did this come in
// before lunch."
//
// Both helpers fall through to the original ISO string on parse
// failure (don't pretend an unparseable timestamp is a real date).

export function formatShortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

export function formatShortDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month:  'short',
    day:    'numeric',
    hour:   'numeric',
    minute: '2-digit',
  })
}
