import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_NEAR_MISS_STATUSES,
  compareForTriage,
  ageInDays,
  type NearMissRow,
  type NearMissSeverity,
  type NearMissStatus,
} from '@soteria/core/nearMiss'

// /near-miss tab — Triage list. Reuses the same types + helpers as
// the web build via @soteria/core. Default view = active reports
// (new + triaged + investigating), severity desc → oldest first.
//
// Pull to refresh; tap a row to open the detail screen; FAB-style
// "+ Report" button bottom-right routes to /near-miss/new.

const SEVERITY_BG: Record<NearMissSeverity, string> = {
  extreme:  '#DC2626',  // rose-600
  high:     '#F97316',  // orange-500
  moderate: '#FBBF24',  // amber-400
  low:      '#10B981',  // emerald-500
}
const SEVERITY_FG: Record<NearMissSeverity, string> = {
  extreme:  '#fff',
  high:     '#fff',
  moderate: '#0F172A',
  low:      '#fff',
}

const STATUS_LABEL: Record<NearMissStatus, string> = {
  new: 'New', triaged: 'Triaged', investigating: 'Investigating',
  closed: 'Closed', escalated_to_risk: 'Escalated',
}

export default function NearMissListScreen() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<NearMissRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) { setRows([]); return }
    setError(null)
    const { data, error } = await supabase
      .from('near_misses')
      .select('*')
      .eq('tenant_id', tenant.id)
      .in('status', ACTIVE_NEAR_MISS_STATUSES as readonly string[])
      .order('reported_at', { ascending: false })
      .limit(200)
    if (error) {
      setError(error.message)
      setRows(null)
      return
    }
    setRows(((data ?? []) as NearMissRow[]).slice().sort(compareForTriage))
  }, [tenant?.id])

  // Refetch on focus so a freshly-filed report from /near-miss/new
  // shows up when the user navigates back.
  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Near-Miss</Text>
        <Text style={styles.subtitle}>Active reports for this tenant</Text>
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
          <Text style={styles.emptyText}>No active near-miss reports.</Text>
          <Link href="/near-miss/new" asChild>
            <Pressable>
              {({ pressed }) => (
                <Text style={[styles.emptyCta, pressed && { opacity: 0.6 }]}>File the first one →</Text>
              )}
            </Pressable>
          </Link>
        </View>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/near-miss/[id]', params: { id: item.id } }} asChild>
              <Pressable>
                {({ pressed }) => (
                  <View style={[styles.row, pressed && { opacity: 0.7 }]}>
                    <View style={[styles.sevPill, { backgroundColor: SEVERITY_BG[item.severity_potential] }]}>
                      <Text style={[styles.sevText, { color: SEVERITY_FG[item.severity_potential] }]}>
                        {item.severity_potential.slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowNumber}>{item.report_number}</Text>
                      <Text style={styles.rowDescription} numberOfLines={2}>{item.description}</Text>
                      <Text style={styles.rowMeta}>
                        {STATUS_LABEL[item.status]} · {item.hazard_category} · {ageInDays(item)} d ago
                      </Text>
                    </View>
                  </View>
                )}
              </Pressable>
            </Link>
          )}
        />
      )}

      <Link href="/near-miss/new" asChild>
        <Pressable>
          {({ pressed }) => (
            <View style={[styles.fab, pressed && { opacity: 0.85 }]}>
              <Text style={styles.fabText}>+ Report</Text>
            </View>
          )}
        </Pressable>
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  header:       { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 2 },
  title:        { fontSize: 22, fontWeight: '700' },
  subtitle:     { fontSize: 12, opacity: 0.6 },

  errorBox:     { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:    { color: '#7F1D1D', fontSize: 12 },

  center:       { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  emptyText:    { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  emptyCta:     { fontSize: 14, fontWeight: '600', color: '#1e3a8a' },

  listContent:  { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 88 },

  row:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, marginVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  sevPill:      { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  sevText:      { fontSize: 12, fontWeight: '800' },
  rowBody:      { flex: 1, gap: 2 },
  rowNumber:    { fontFamily: 'SpaceMono', fontSize: 11, opacity: 0.6 },
  rowDescription: { fontSize: 14, fontWeight: '500' },
  rowMeta:      { fontSize: 11, opacity: 0.6, marginTop: 2 },

  fab:          { position: 'absolute', right: 16, bottom: 24, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, backgroundColor: '#1e3a8a', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  fabText:      { color: '#fff', fontWeight: '700', fontSize: 14 },
})
