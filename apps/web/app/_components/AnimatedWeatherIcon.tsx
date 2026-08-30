// Animated weather glyphs for the dashboard hero's WeatherCard.
//
// Hand-authored SVG rather than a lucide icon, because the point is that the
// parts move independently: the sun's rays turn while its disc breathes,
// drops fall out of a cloud that is itself drifting. A single-path icon can
// only be spun or scaled as a whole, which reads as a loading spinner.
//
// The motion is deliberately slow and low-contrast. This sits permanently in
// the hero of a safety dashboard — it should register as ambient weather, not
// compete with the alerts below it. Every keyframe is defined in globals.css
// alongside the app's other motion and is switched off under
// prefers-reduced-motion, where these degrade to the same glyphs, static.
//
// Colour: the glyph body inherits `currentColor` (brand yellow in the hero),
// and precipitation is drawn in translucent white — already the card's
// secondary colour, and it stays legible against the navy without
// introducing a third hue.

interface Props {
  /** WMO weather code from Open-Meteo. */
  code: number
  className?: string
}

// Shared geometry so the cloud sits identically across every cloudy variant —
// drops, flakes, and the bolt are positioned against these coordinates.
const CLOUD_PATH =
  'M7 18h9.5a3.5 3.5 0 0 0 .3-6.99A5.5 5.5 0 0 0 6.4 10.2 4 4 0 0 0 7 18Z'

const DROP = 'text-white/70'

export function AnimatedWeatherIcon({ code, className = '' }: Props) {
  const kind = weatherKind(code)

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      // Decorative: WeatherCard renders the condition label as text beside it.
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'clear'  && <Sun />}
      {kind === 'cloud'  && <DriftingCloud />}
      {kind === 'fog'    && <Fog />}
      {kind === 'rain'   && <Precipitation count={3} />}
      {kind === 'snow'   && <Precipitation count={3} snow />}
      {kind === 'storm'  && <Storm />}
    </svg>
  )
}

function Sun() {
  return (
    <>
      {/* Rays turn as one group; the disc breathes on its own cycle so the
          two never look mechanically locked together. */}
      <g className="animate-wx-sun-spin">
        {[0, 45, 90, 135, 180, 225, 270, 315].map(deg => (
          <line
            key={deg}
            x1="12" y1="2.4" x2="12" y2="4.6"
            transform={`rotate(${deg} 12 12)`}
          />
        ))}
      </g>
      <circle cx="12" cy="12" r="4.2" className="animate-wx-sun-pulse" />
    </>
  )
}

function DriftingCloud() {
  return (
    <g className="animate-wx-drift">
      <path d={CLOUD_PATH} />
    </g>
  )
}

function Fog() {
  // Three bands on staggered delays, so they slide out of phase with each
  // other the way real fog layers do.
  return (
    <>
      <g className="animate-wx-drift">
        <path d={CLOUD_PATH} />
      </g>
      {[
        { y: 20.2, x1: 5,   x2: 17,   delay: '0s'   },
        { y: 22,   x1: 7.5, x2: 19.5, delay: '1.1s' },
      ].map(band => (
        <line
          key={band.y}
          x1={band.x1} y1={band.y} x2={band.x2} y2={band.y}
          className="animate-wx-fog-band"
          style={{ animationDelay: band.delay }}
        />
      ))}
    </>
  )
}

function Precipitation({ count, snow = false }: { count: number; snow?: boolean }) {
  // Evenly spaced under the cloud, each on its own delay so they never fall
  // in lockstep. Delay is a fraction of the cycle, hence the /count.
  const cycleMs = snow ? 2600 : 1400
  const xs = Array.from({ length: count }, (_, i) => 8.5 + i * 3.5)

  return (
    <>
      <g className="animate-wx-drift">
        <path d={CLOUD_PATH} />
      </g>
      {xs.map((x, i) => {
        const style = { animationDelay: `${(i * cycleMs) / count}ms` }
        return snow ? (
          <circle
            key={x}
            cx={x} cy={20.5} r={0.9}
            fill="currentColor" stroke="none"
            className={`animate-wx-snow-fall ${DROP}`}
            style={style}
          />
        ) : (
          <line
            key={x}
            x1={x} y1={20} x2={x - 0.6} y2={21.8}
            className={`animate-wx-fall ${DROP}`}
            style={style}
          />
        )
      })}
    </>
  )
}

function Storm() {
  return (
    <>
      <g className="animate-wx-drift">
        <path d={CLOUD_PATH} />
      </g>
      <path
        d="M13 19.5l-2.4 3.2h2.6L11.8 26"
        className="animate-wx-flash"
        // Drawn slightly heavier: the bolt is the subject of this glyph.
        strokeWidth={1.9}
      />
    </>
  )
}

export type WeatherKind = 'clear' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm'

/**
 * Collapse a WMO weather code to the glyph that represents it.
 *
 * Deliberately coarser than the text label: "Drizzle", "Rain", and "Showers"
 * are three different words but one falling-drops picture, and inventing a
 * distinct animation for each would be detail nobody reads at 40px. The
 * label beside the glyph carries the precision.
 */
export function weatherKind(code: number): WeatherKind {
  if (code === 0)                 return 'clear'
  if (code <= 3)                  return 'cloud'
  if (code === 45 || code === 48) return 'fog'
  // Drizzle and rain are separate WMO bands with an unassigned gap at 58-60.
  // Spanning 51-67 in one range would sweep that gap into "rain" while the
  // text label falls through to "Cloudy" — so these mirror
  // weatherLabelForCode's boundaries exactly rather than approximating them.
  if (code >= 51 && code <= 57)   return 'rain'   // drizzle
  if (code >= 61 && code <= 67)   return 'rain'   // rain
  if (code >= 71 && code <= 77)   return 'snow'
  if (code >= 80 && code <= 82)   return 'rain'   // showers
  if (code >= 85 && code <= 86)   return 'snow'   // snow showers
  if (code >= 95)                 return 'storm'
  return 'cloud'
}
