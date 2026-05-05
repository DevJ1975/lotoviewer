import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import type { Band } from '@soteria/core/risk'
import type { RiskSummary, RiskStatus } from '@soteria/core/queries/risks'

// /risk tab — Register list. Read-only on this slice; the heat map
// view lands in slice 2 and the new-risk wizard in slice 3.
//
// Default filter hides closed + accepted_exception so the list
// shows the active register; toggle exposes them.

const BAND_BG: Record<Band, string> = {
  extreme: '#DC2626', high: '#F97316', moderate: '#FBBF24', low: '#10B981',
}
const BAND_FG: Record<Band, string> = {
  extreme: '#fff', high: '#fff', moderate: '#0F172A', low: '#fff',
}
const STATUS_LABEL: Record<RiskStatus, string> = {
  open: 'Open', in_review: 'In review', controls_in_progress: 'Controls',
  monitoring: 'Monitoring', closed: 'Closed', accepted_exception: 'Accepted',
}

export default function RiskListScreen() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<RiskSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [showClosed, setShowClosed] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) { setRows([]); return }
    setError(null)
    let q = supabase
      .from('risks')
      .select('id, risk_number, title, hazard_category, status, inherent_severity, inherent_likelihood, inherent_score, inherent_band, residual_severity, residual_likelihood, residual_score, residual_band, assigned_to, next_review_date, created_at, updated_at')
      .eq('tenant_id', tenant.id)
      .order('residual_score', { ascending: false, nullsFirst: false })
      .order('inherent_score', { ascending: false })
      .limit(200)
    if (!showClosed) q = q.not('status', 'in', '(closed,accepted_exception)')
    const { data, error } = await q
    if (error) {
      setError(error.message)
      setRows(null)
      return
    }
    setRows((data ?? []) as RiskSummary[])
  }, [tenant?.id, showClosed])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.header}>
          <Text style={styles.title}>Risk Register</Text>
          <Text style={styles.subtitle}>ISO 45001 6.1 · sorted by residual score desc</Text>
        </View>
        <Link href="/risk/heatmap" asChild>
          <Pressable>
            {({ pressed }) => (
              <View style={[styles.heatmapBtn, pressed && { opacity: 0.6 }]}>
                <Text style={styles.heatmapBtnText}>Heat map →</Text>
              </View>
            )}
          </Pressable>
        </Link>
      </View>

      <View style={styles.filterRow}>
        <Pressable onPress={() => setShowClosed(c => !c)}>
          {({ pressed }) => (
            <View style={[styles.toggle, pressed && { opacity: 0.6 }, showClosed && styles.toggleActive]}>
              <Text style={[styles.toggleText, showClosed && styles.toggleTextActive]}>
                {showClosed ? '✓ Show closed' : 'Show closed'}
              </Text>
            </View>
          )}
        </Pressable>
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {rows === null && !error ? (
        <View style={styles.center}><ActivityIndicator /></View>
      ) : rows && rows.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>
            {showClosed ? 'No risks in the register.' : 'No active risks.'}
          </Text>
          <Text style={styles.emptyHint}>Create one from the web for now — mobile wizard ships in slice 3.</Text>
        </View>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => {
            const effBand = item.residual_band ?? item.inherent_band
            const effScore = item.residual_score ?? item.inherent_score
            return (
              <Link href={{ pathname: '/risk/[id]', params: { id: item.id } }} asChild>
                <Pressable>
                  {({ pressed }) => (
                    <View style={[styles.row, pressed && { opacity: 0.7 }]}>
                      <View style={[styles.bandPill, { backgroundColor: BAND_BG[effBand] }]}>
                        <Text style={[styles.bandScore, { color: BAND_FG[effBand] }]}>
                          {effScore}
                        </Text>
                      </View>
                      <View style={styles.rowBody}>
                        <Text style={styles.rowNumber}>{item.risk_number}</Text>
                        <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                        <Text style={styles.rowMeta}>
                          {STATUS_LABEL[item.status]} · {item.hazard_category}
                          {item.next_review_date ? ` · review ${item.next_review_date}` : ''}
                        </Text>
                      </View>
                    </View>
                  )}
                </Pressable>
              </Link>
            )
          }}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  headerRow:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  header:       { gap: 2 },
  title:        { fontSize: 22, fontWeight: '700' },
  subtitle:     { fontSize: 12, opacity: 0.6 },
  heatmapBtn:   { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#1e3a8a' },
  heatmapBtnText: { fontSize: 12, fontWeight: '600', color: '#1e3a8a' },

  filterRow:    { paddingHorizontal: 16, paddingVertical: 6, alignItems: 'flex-end' },
  toggle:       { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  toggleActive: { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  toggleText:   { fontSize: 11 },
  toggleTextActive: { color: '#fff', fontWeight: '600' },

  errorBox:     { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:    { color: '#7F1D1D', fontSize: 12 },

  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  emptyText:    { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  emptyHint:    { fontSize: 12, opacity: 0.5, textAlign: 'center', fontStyle: 'italic' },

  listContent:  { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 24 },

  row:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, marginVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  bandPill:     { width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  bandScore:    { fontSize: 14, fontWeight: '800' },

  rowBody:      { flex: 1, gap: 2 },
  rowNumber:    { fontFamily: 'SpaceMono', fontSize: 11, opacity: 0.6 },
  rowTitle:     { fontSize: 14, fontWeight: '600' },
  rowMeta:      { fontSize: 11, opacity: 0.6, marginTop: 2 },
})
