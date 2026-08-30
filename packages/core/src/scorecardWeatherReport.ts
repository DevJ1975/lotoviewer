// Pure logic for the weekly EHS "weather report" email. No I/O.
//
// Turns this-week vs last-week metric values into report rows with a delta,
// direction, and a good/bad/neutral tone (tone depends on whether higher is
// better for that metric — e.g. recordables down = good; near-miss reports up
// = good reporting culture; permit volume = neutral).

export type WeatherDirection = 'up' | 'down' | 'flat'
export type WeatherTone = 'good' | 'bad' | 'neutral'

export interface WeatherMetricInput {
  key:            string
  label:          string
  current:        number
  previous:       number
  /** true: higher is better; false: lower is better; null: neutral (no tone). */
  higherIsBetter: boolean | null
  unit?:          string
}

export interface WeatherMetricRow {
  key:       string
  label:     string
  current:   number
  previous:  number
  delta:     number
  /** Percent change vs last week; null when last week was 0 (no baseline). */
  deltaPct:  number | null
  direction: WeatherDirection
  tone:      WeatherTone
  /** Whether the week-to-week move is beyond normal noise (drives tone). */
  significant: boolean
  unit:      string
}

export function buildWeatherRow(input: WeatherMetricInput): WeatherMetricRow {
  const delta = round1(input.current - input.previous)
  const direction: WeatherDirection = input.current > input.previous ? 'up'
    : input.current < input.previous ? 'down' : 'flat'
  // Guard the percentage against a tiny (sub-unit) baseline, not just an exact
  // zero — otherwise 0.2 → 0.6 reads as "+200%".
  const deltaPct = Math.abs(input.previous) < 1
    ? null
    : round1(((input.current - input.previous) / Math.abs(input.previous)) * 100)

  // Significance gate: week-to-week counts are small and noisy, so a ±1 move is
  // almost always noise. Treat a change as real only when it exceeds ~1 Poisson
  // standard deviation of the combined counts; below that we don't color it
  // good/bad. Keeps the weekly email from crying wolf on normal variation.
  const significant = Math.abs(input.current - input.previous) >= Math.sqrt(input.previous + input.current)

  let tone: WeatherTone = 'neutral'
  if (input.higherIsBetter !== null && direction !== 'flat' && significant) {
    const improved = direction === 'up' ? input.higherIsBetter : !input.higherIsBetter
    tone = improved ? 'good' : 'bad'
  }

  return {
    key: input.key,
    label: input.label,
    current: input.current,
    previous: input.previous,
    delta,
    deltaPct,
    direction,
    tone,
    significant,
    unit: input.unit ?? '',
  }
}

export function buildWeatherReport(inputs: WeatherMetricInput[]): WeatherMetricRow[] {
  return inputs.map(buildWeatherRow)
}

/** Compact "↑ 3 (+12%)" / "↓ 2" / "—" summary for an email cell. */
export function formatDelta(row: WeatherMetricRow): string {
  if (row.direction === 'flat') return '—'
  const arrow = row.direction === 'up' ? '↑' : '↓'
  const pct = row.deltaPct === null ? '' : ` (${row.deltaPct > 0 ? '+' : ''}${row.deltaPct}%)`
  return `${arrow} ${Math.abs(row.delta)}${pct}`
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
