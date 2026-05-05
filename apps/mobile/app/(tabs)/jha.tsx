import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import type { JhaRow, JhaStatus, JhaFrequency } from '@soteria/core/jha'

// /jha tab — register list. iPad-class screen target so the same
// information density as the web list is OK. Tap a row → detail.
// Admin-only "+ New" FAB routes to the create form (slice 2).

const STATUS_BG: Record<JhaStatus, string> = {
  draft:       '#e2e8f0',
  in_review:   '#fef3c7',
  approved:    '#d1fae5',
  superseded:  '#f1f5f9',
}
const STATUS_FG: Record<JhaStatus, string> = {
  draft:       '#334155',
  in_review:   '#92400e',
  approved:    '#065f46',
  superseded:  '#94a3b8',
}

const FREQUENCY_LABEL: Record<JhaFrequency, string> = {
  continuous: 'Continuous', daily: 'Daily', weekly: 'Weekly',
  monthly: 'Monthly', quarterly: 'Quarterly',
  annually: 'Annually', as_needed: 'As needed',
}

export default function JhaListScreen() {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canCreate = !!profile?.is_admin || !!profile?.is_superadmin

  const [rows, setRows] = useState<JhaRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) { setRows([]); return }
    setError(null)
    const { data, error } = await supabase
      .from('jhas')
      .select('*')
      .eq('tenant_id', tenant.id)
      .neq('status', 'superseded')
      .order('updated_at', { ascending: false })
      .limit(200)
    if (error) {
      setError(error.message)
      setRows(null)
      return
    }
    setRows((data ?? []) as JhaRow[])
  }, [tenant?.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Job Hazard Analyses</Text>
        <Text style={styles.subtitle}>Task-level hazard breakdowns · ISO 45001 6.1.2.2</Text>
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
          <Text style={styles.emptyText}>No active JHAs yet.</Text>
          {canCreate && (
            <Link href="/jha/new" asChild>
              <Pressable>
                {({ pressed }) => (
                  <Text style={[styles.emptyCta, pressed && { opacity: 0.6 }]}>Create the first one →</Text>
                )}
              </Pressable>
            </Link>
          )}
        </View>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/jha/[id]', params: { id: item.id } }} asChild>
              <Pressable>
                {({ pressed }) => (
                  <View style={[styles.row, pressed && { opacity: 0.7 }]}>
                    <View style={styles.rowBody}>
                      <Text style={styles.rowNumber}>{item.job_number}</Text>
                      <Text style={styles.rowTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={styles.rowMeta}>
                        {FREQUENCY_LABEL[item.frequency]}
                        {item.location ? ` · ${item.location}` : ''}
                        {item.performed_by ? ` · ${item.performed_by}` : ''}
                      </Text>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: STATUS_BG[item.status] }]}>
                      <Text style={[styles.statusText, { color: STATUS_FG[item.status] }]}>
                        {item.status.replace('_', ' ')}
                      </Text>
                    </View>
                  </View>
                )}
              </Pressable>
            </Link>
          )}
        />
      )}

      {canCreate && (
        <Link href="/jha/new" asChild>
          <Pressable>
            {({ pressed }) => (
              <View style={[styles.fab, pressed && { opacity: 0.85 }]}>
                <Text style={styles.fabText}>+ New JHA</Text>
              </View>
            )}
          </Pressable>
        </Link>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container:      { flex: 1 },
  header:         { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 2 },
  title:          { fontSize: 22, fontWeight: '700' },
  subtitle:       { fontSize: 12, opacity: 0.6 },

  errorBox:       { marginHorizontal: 16, marginTop: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:      { color: '#7F1D1D', fontSize: 12 },

  center:         { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty:          { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
  emptyText:      { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  emptyCta:       { fontSize: 14, fontWeight: '600', color: '#1e3a8a' },

  listContent:    { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 88 },

  row:            { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, marginVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  rowBody:        { flex: 1, gap: 2 },
  rowNumber:      { fontFamily: 'SpaceMono', fontSize: 11, opacity: 0.6 },
  rowTitle:       { fontSize: 14, fontWeight: '600' },
  rowMeta:        { fontSize: 11, opacity: 0.6, marginTop: 2 },
  statusPill:     { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText:     { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  fab:            { position: 'absolute', right: 16, bottom: 24, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, backgroundColor: '#1e3a8a', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  fabText:        { color: '#fff', fontWeight: '700', fontSize: 14 },
})
