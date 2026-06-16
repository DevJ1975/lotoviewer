import { type JSX } from 'react'
import { StyleSheet } from 'react-native'
import { BarChart, LineChart } from 'react-native-gifted-charts'

import { Text, View } from '@/components/Themed'

export interface ForecastSeriesPoint {
  label: string
  value: number | null
  frontColor?: string
}

export interface ForecastChartProps {
  title: string
  unit: string
  points: ForecastSeriesPoint[]
  kind?: 'line' | 'bar'
}

const ACCENT = '#1e3a8a'
const GRID_COLOR = '#e2e8f0'
const AXIS_TEXT = '#64748b'

/**
 * Compact, themed wrapper over react-native-gifted-charts. A missing forecast
 * value must never read as a real zero on a go/no-go safety board. For lines we
 * DROP null points (gifted-charts' hideDataPoint only hides the marker, not the
 * segment, so a null would otherwise draw a line plunging to 0); the x-axis
 * simply skips that slot. For bars we keep null→0 with the marker hidden, since
 * a zero-height bar correctly reads as "no bar".
 */
export function ForecastChart({
  title,
  unit,
  points,
  kind = 'line',
}: ForecastChartProps): JSX.Element {
  const isBar = kind === 'bar'
  const data = (isBar ? points : points.filter(point => point.value !== null)).map(point => ({
    label: point.label,
    value: point.value ?? 0,
    hideDataPoint: point.value === null,
    frontColor: point.frontColor ?? ACCENT,
  }))

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>
        {title} <Text style={styles.unit}>({unit})</Text>
      </Text>
      {kind === 'bar' ? (
        <BarChart
          data={data}
          height={140}
          barWidth={14}
          spacing={18}
          initialSpacing={12}
          frontColor={ACCENT}
          noOfSections={4}
          yAxisColor={GRID_COLOR}
          xAxisColor={GRID_COLOR}
          rulesColor={GRID_COLOR}
          yAxisTextStyle={styles.axisText}
          xAxisLabelTextStyle={styles.axisText}
        />
      ) : (
        <LineChart
          data={data}
          height={140}
          thickness={2}
          color={ACCENT}
          dataPointsColor={ACCENT}
          spacing={28}
          initialSpacing={12}
          noOfSections={4}
          yAxisColor={GRID_COLOR}
          xAxisColor={GRID_COLOR}
          rulesColor={GRID_COLOR}
          yAxisTextStyle={styles.axisText}
          xAxisLabelTextStyle={styles.axisText}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap:     { gap: 8, backgroundColor: 'transparent' },
  title:    { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  unit:     { fontSize: 12, fontWeight: '600', color: AXIS_TEXT },
  axisText: { fontSize: 10, color: AXIS_TEXT },
})
