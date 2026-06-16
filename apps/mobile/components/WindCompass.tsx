import { useEffect, useRef, type JSX } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Circle, G, Line, Polygon, Text as SvgText } from 'react-native-svg'

import { Text, View } from '@/components/Themed'
import { windDirectionLabel } from '@soteria/core/safetyWeather'

export interface WindCompassProps {
  /** Meteorological "from" bearing in degrees, or null when no live wind data. */
  directionDeg: number | null
  windMph: number | null
  gustMph: number | null
  /** Tone color supplied by the caller (green / amber / red). */
  ringColor: string
  size?: number
}

const DEFAULT_SIZE = 220

// Cardinal labels are drawn just inside the ring; the four ticks share the
// same angles. North is up (−90° from SVG's 0°-is-east convention).
const CARDINALS: ReadonlyArray<{ label: string; angleDeg: number }> = [
  { label: 'N', angleDeg: 0 },
  { label: 'E', angleDeg: 90 },
  { label: 'S', angleDeg: 180 },
  { label: 'W', angleDeg: 270 },
]

function round(value: number | null): string {
  return value === null ? '—' : String(Math.round(value))
}

/**
 * SVG compass dial with a reanimated needle. The static dial and the rotating
 * needle live in two separate <Svg> layers: the needle's <Svg> sits inside an
 * Animated.View whose transform we animate, which sidesteps the known issues
 * with animating SVG element props directly through reanimated.
 */
export function WindCompass({
  directionDeg,
  windMph,
  gustMph,
  ringColor,
  size = DEFAULT_SIZE,
}: WindCompassProps): JSX.Element {
  const center = size / 2
  const radius = center - 14
  const hasDirection = directionDeg !== null

  // The needle points toward the bearing. We animate an *unwrapped* angle so a
  // bearing crossing the 0°/360° seam (e.g. 350°→010°) sweeps the short way
  // (+20°) instead of unwinding −340°.
  const rotation = useSharedValue(directionDeg ?? 0)
  const target = useRef(directionDeg ?? 0)
  const prevBearing = useRef(directionDeg ?? 0)

  useEffect(() => {
    if (directionDeg === null) return
    const delta = ((directionDeg - prevBearing.current + 540) % 360) - 180
    prevBearing.current = directionDeg
    target.current += delta
    rotation.value = withTiming(target.current, { duration: 600 })
  }, [directionDeg, rotation])

  const needleStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }))

  const compassPoint = windDirectionLabel(directionDeg)

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={ringColor}
          strokeWidth={8}
          fill="none"
        />
        <G>
          {CARDINALS.map(({ label, angleDeg }) => {
            const rad = ((angleDeg - 90) * Math.PI) / 180
            const tickOuter = radius - 4
            const tickInner = radius - 16
            const labelR = radius - 30
            return (
              <G key={label}>
                <Line
                  x1={center + tickInner * Math.cos(rad)}
                  y1={center + tickInner * Math.sin(rad)}
                  x2={center + tickOuter * Math.cos(rad)}
                  y2={center + tickOuter * Math.sin(rad)}
                  stroke="#94a3b8"
                  strokeWidth={2}
                />
                <SvgText
                  x={center + labelR * Math.cos(rad)}
                  y={center + labelR * Math.sin(rad)}
                  fill="#475569"
                  fontSize={14}
                  fontWeight="700"
                  textAnchor="middle"
                  alignmentBaseline="central"
                >
                  {label}
                </SvgText>
              </G>
            )
          })}
        </G>
      </Svg>

      {hasDirection && (
        <Animated.View style={[styles.needleLayer, { width: size, height: size }, needleStyle]}>
          <Svg width={size} height={size}>
            <Polygon
              points={`${center},${center - radius + 18} ${center - 9},${center + 14} ${center + 9},${center + 14}`}
              fill={ringColor}
            />
            <Circle cx={center} cy={center} r={6} fill={ringColor} />
          </Svg>
        </Animated.View>
      )}

      <View style={styles.centerReadout} pointerEvents="none">
        {hasDirection ? (
          <>
            <Text style={styles.point}>{compassPoint}</Text>
            <Text style={styles.speed}>{round(windMph)}</Text>
            <Text style={styles.unit}>mph</Text>
            {gustMph !== null && <Text style={styles.gust}>G {Math.round(gustMph)}</Text>}
          </>
        ) : (
          <Text style={styles.noData}>No data</Text>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap:         { alignItems: 'center', justifyContent: 'center', position: 'relative', backgroundColor: 'transparent' },
  needleLayer:  { position: 'absolute', top: 0, left: 0 },
  centerReadout:{ position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  point:        { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  speed:        { fontSize: 34, fontWeight: '800', color: '#0f172a', lineHeight: 38 },
  unit:         { fontSize: 12, color: '#64748b', marginTop: -2 },
  gust:         { fontSize: 13, fontWeight: '700', color: '#b45309', marginTop: 2 },
  noData:       { fontSize: 14, fontWeight: '700', color: '#94a3b8' },
})
