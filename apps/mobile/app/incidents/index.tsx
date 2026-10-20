import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'

import { Centered, ErrorBanner, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ACTIVE_INCIDENT_STATUSES,
  INCIDENT_TYPE_LABEL,
  STATUS_LABEL,
  ageInDays,
  compareForTriage,
  type IncidentRow,
} from '@soteria/core/incident'

// Active incidents for the tenant, most severe first. Reads go straight to
// Supabase under RLS; filing goes through the API (see lib/incidents.ts).

export default function IncidentsScreen() {
  return (
    <ModuleGate featureId="incidents" name="Incidents">
      <IncidentList />
    </ModuleGate>
  )
}

function IncidentList() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<IncidentRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) { setRows([]); return }
    setError(null)
    const { data, error: err } = await supabase
      .from('incidents')
      .select('*')
      .eq('tenant_id', tenant.id)
      .in('status', ACTIVE_INCIDENT_STATUSES as readonly string[])
      .order('reported_at', { ascending: false })
      .limit(200)
    if (err) { setError(err.message); setRows(null); return }
    setRows(((data ?? []) as IncidentRow[]).slice().sort(compareForTriage))
  }, [tenant?.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  return (
    <View style={styles.container}>
      <ErrorBanner message={error} />
      {rows === null && !error ? (
        <Centered><ActivityIndicator /></Centered>
      ) : rows && rows.length === 0 ? (
        <Centered><Text style={formStyles.empty}>No active incidents.</Text></Centered>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <Link href={{ pathname: '/incidents/[id]', params: { id: item.id } }} asChild>
              <Pressable>
                {({ pressed }) => (
                  <View style={[formStyles.card, styles.row, pressed && { opacity: 0.7 }]}>
                    <Text style={formStyles.mono}>{item.report_number}</Text>
                    <Text style={formStyles.rowTitle} numberOfLines={2}>{item.description}</Text>
                    <Text style={formStyles.rowMeta}>
                      {INCIDENT_TYPE_LABEL[item.incident_type]} · {STATUS_LABEL[item.status]} · {ageInDays(item)} d ago
                    </Text>
                  </View>
                )}
              </Pressable>
            </Link>
          )}
        />
      )}
      <Link href="/incidents/new" asChild>
        <Pressable accessibilityRole="button">
          {({ pressed }) => (
            <View style={[formStyles.fab, pressed && { opacity: 0.85 }]}>
              <Text style={formStyles.fabText}>+ Report incident</Text>
            </View>
          )}
        </Pressable>
      </Link>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  list: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 96 },
  row: { marginVertical: 4 },
})
