import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, SectionList, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import {
  OPERATING_CONDITION_ORDER,
  walkdownGroups,
  type AspectOperatingCondition,
} from '@soteria/core/environmentalAspect'

// /environmental/aspects — the aspects register for a supervisor's
// walk-down (plan D14). Read-only: grouped by process area, significant
// aspects first, with N / A / E chips showing which operating conditions
// have been scored. Reads environmental_aspect_register under RLS, the same
// view the web register uses, so both show the same significance. The
// screen checks the module itself, so a deep link cannot open it while the
// Environmental module is off.

interface CurrentScore { operating_condition: AspectOperatingCondition; score: number; significant: boolean }

interface RegisterRow {
  id:             string
  activity:       string
  aspect:         string
  impact:         string
  process_area:   string | null
  controls:       string | null
  significant:    boolean
  max_score:      number | null
  current_scores: CurrentScore[]
}

type WalkdownRow = RegisterRow & { processArea: string | null; maxScore: number | null }

const LETTER: Record<AspectOperatingCondition, string> = { normal: 'N', abnormal: 'A', emergency: 'E' }

/** Enough for any one site's register; the screen says so if a tenant ever exceeds it. */
const ROW_LIMIT = 2000

export default function EnvironmentalAspectsScreen() {
  const { tenant, loading: tenantLoading } = useTenant()
  const moduleOn = isModuleVisible('environmental', tenant?.modules)
  const [rows, setRows] = useState<WalkdownRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  // A tenant switch mid-request must not show the previous tenant's register.
  const latestRequest = useRef(0)

  const load = useCallback(async () => {
    if (!tenant?.id || !moduleOn) return
    const request = ++latestRequest.current
    setError(null)
    const { data, error: readError } = await supabase
      .from('environmental_aspect_register')
      .select('id, activity, aspect, impact, process_area, controls, significant, max_score, current_scores')
      .eq('tenant_id', tenant.id)
      .is('obsolete_at', null)
      .limit(ROW_LIMIT)
    if (request !== latestRequest.current) return
    if (readError) { setError(readError.message); return }
    setRows(((data ?? []) as RegisterRow[]).map(row => ({ ...row, processArea: row.process_area, maxScore: row.max_score })))
  }, [tenant?.id, moduleOn])

  useEffect(() => { void load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (!tenant && !tenantLoading) {
    return <View style={styles.center}><Text style={styles.empty}>Choose an organization to see its aspects.</Text></View>
  }
  if (tenant && !moduleOn) {
    return <View style={styles.center}><Text style={styles.empty}>The Environmental module is not enabled for this organization.</Text></View>
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.error}>{error}</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    )
  }
  if (rows === null) return <View style={styles.center}><ActivityIndicator /></View>

  const sections = walkdownGroups(rows).map(group => ({ title: group.processArea, data: group.aspects }))

  return (
    <SectionList
      sections={sections}
      keyExtractor={row => row.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      contentContainerStyle={styles.list}
      ListEmptyComponent={<Text style={styles.empty}>No aspects recorded for this site yet.</Text>}
      ListFooterComponent={rows.length === ROW_LIMIT
        ? <Text style={styles.empty}>Showing the first {ROW_LIMIT} aspects. Use the web register to see them all.</Text>
        : null}
      renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
      renderItem={({ item }) => <AspectCard row={item} />}
    />
  )
}

function AspectCard({ row }: { row: WalkdownRow }) {
  const byCondition = new Map(row.current_scores.map(score => [score.operating_condition, score]))
  return (
    <View style={[styles.card, row.significant && styles.cardSignificant]}>
      <View style={styles.cardHeader}>
        <Text style={styles.activity}>{row.activity}</Text>
        {row.significant && <Text style={styles.significant}>SIGNIFICANT</Text>}
      </View>
      <Text style={styles.detail}>{row.aspect} → {row.impact}</Text>
      <View style={styles.chips}>
        {OPERATING_CONDITION_ORDER.map(condition => {
          const score = byCondition.get(condition)
          return (
            <Text key={condition}
              accessibilityLabel={score ? `${condition}: score ${score.score}` : `${condition}: not scored`}
              style={[styles.chip, !score ? styles.chipMissing : score.significant ? styles.chipSignificant : styles.chipScored]}>
              {LETTER[condition]}{score ? ` ${score.score}` : ''}
            </Text>
          )
        })}
      </View>
      <Text style={styles.controls}>{row.controls ? `Controls: ${row.controls}` : 'No controls recorded'}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  center:          { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error:           { color: '#b91c1c', textAlign: 'center' },
  retry:           { marginTop: 12, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8' },
  retryText:       { fontSize: 14, fontWeight: '600' },
  list:            { padding: 16, gap: 10 },
  empty:           { textAlign: 'center', opacity: 0.6, marginTop: 40 },
  section:         { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6, marginTop: 12, marginBottom: 4 },
  card:            { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', gap: 6, marginBottom: 8 },
  cardSignificant: { borderColor: '#e11d48' },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  activity:        { flex: 1, fontSize: 15, fontWeight: '600' },
  significant:     { fontSize: 10, fontWeight: '700', color: '#e11d48' },
  detail:          { fontSize: 13, opacity: 0.8 },
  chips:           { flexDirection: 'row', gap: 6 },
  chip:            { fontSize: 11, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  chipScored:      { backgroundColor: '#d1fae5', color: '#065f46' },
  chipSignificant: { backgroundColor: '#ffe4e6', color: '#9f1239' },
  chipMissing:     { borderWidth: 1, borderStyle: 'dashed', borderColor: '#94a3b8', color: '#64748b' },
  controls:        { fontSize: 12, opacity: 0.7 },
})
