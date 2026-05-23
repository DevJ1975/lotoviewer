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
  unit:      string
}

export function buildWeatherRow(input: WeatherMetricInput): WeatherMetricRow {
  const delta = round1(input.current - input.previous)
  const direction: WeatherDirection = input.current > input.previous ? 'up'
    : input.current < input.previous ? 'down' : 'flat'
  const deltaPct = input.previous === 0
    ? null
    : round1(((input.current - input.previous) / Math.abs(input.previous)) * 100)

  let tone: WeatherTone = 'neutral'
  if (input.higherIsBetter !== null && direction !== 'flat') {
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
