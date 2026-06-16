import { useEffect, type JSX } from 'react'
import { StyleSheet } from 'react-native'
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path, type PathProps } from 'react-native-svg'

import { Text, View } from '@/components/Themed'

const AnimatedPath = Animated.createAnimatedComponent(Path)

export interface GaugeArcProps {
  value: number | null
  min: number
  max: number
  color: string
  label: string
  /** Pre-formatted center text, e.g. '106°F' or 'UV 9'. */
  valueText: string
  size?: number
}

const DEFAULT_SIZE = 160
const SWEEP_DEG = 240
const TRACK_COLOR = '#e2e8f0'

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

/** SVG point on the gauge circle for an angle measured clockwise from "up". */
function polar(center: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: center + radius * Math.cos(rad), y: center + radius * Math.sin(rad) }
}

/** Arc path string spanning the full 240° track, centered and bottom-open. */
function trackPath(center: number, radius: number): string {
  const startAngle = -SWEEP_DEG / 2
  const endAngle = SWEEP_DEG / 2
  const start = polar(center, radius, startAngle)
  const end = polar(center, radius, endAngle)
  const largeArc = SWEEP_DEG > 180 ? 1 : 0
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`
}

/**
 * A 240° arc gauge. The background track and a colored foreground share the
 * same path; the foreground reveals a fraction of its length via an animated
 * strokeDashoffset, which is the most reliable way to animate arc fill under
 * reanimated + react-native-svg.
 */
export function GaugeArc({
  value,
  min,
  max,
  color,
  label,
  valueText,
  size = DEFAULT_SIZE,
}: GaugeArcProps): JSX.Element {
  const strokeWidth = size * 0.1
  const center = size / 2
  const radius = center - strokeWidth
  const arcLength = (SWEEP_DEG / 360) * 2 * Math.PI * radius
  const path = trackPath(center, radius)

  const fraction =
    value === null || max <= min ? 0 : clamp01((value - min) / (max - min))

  // Animate the visible length. dashoffset = arcLength → empty; 0 → full.
  const progress = useSharedValue(0)
  useEffect(() => {
    progress.value = withTiming(fraction, { duration: 700 })
  }, [fraction, progress])

  // Typed as PathProps so reanimated accepts the partial update on AnimatedPath
  // (reanimated v4 widens the animatedProps type to the wrapped component's props).
  const animatedProps = useAnimatedProps<PathProps>(() => ({
    strokeDashoffset: arcLength * (1 - progress.value),
  }))

  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Path
          d={path}
          stroke={TRACK_COLOR}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />
        {value !== null && (
          <AnimatedPath
            d={path}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={arcLength}
            animatedProps={animatedProps}
          />
        )}
      </Svg>

      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.value}>{value === null ? '—' : valueText}</Text>
        <Text style={styles.label}>{label}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap:    { alignItems: 'center', justifyContent: 'center', position: 'relative', backgroundColor: 'transparent' },
  readout: { position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  value:   { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  label:   { fontSize: 11, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
})
