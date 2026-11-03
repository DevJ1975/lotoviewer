import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'

import { Centered, ErrorBanner, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatShortDateTime } from '@/lib/dateFormat'
import { supabase } from '@/lib/supabase'

// The signed-in user's own recent observations. Tenant-wide BBS analytics
// stay on the web dashboard.

interface ObservationListRow {
  id:          string
  category:    'safe_behavior' | 'unsafe_act' | 'unsafe_condition'
  severity:    string | null
  description: string
  created_at:  string
}

const CATEGORY_LABEL: Record<ObservationListRow['category'], string> = {
  safe_behavior:    'Safe behavior',
  unsafe_act:       'Unsafe act',
  unsafe_condition: 'Unsafe condition',
}

export default function BbsScreen() {
  return (
    <ModuleGate featureId="bbs" name="Behavior observations">
      <ObservationList />
    </ModuleGate>
  )
}

function ObservationList() {
  const { tenant } = useTenant()
  const { userId } = useAuth()
  const [rows, setRows] = useState<ObservationListRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id || !userId) { setRows([]); return }
    setError(null)
    const { data, error: err } = await supabase
      .from('bbs_observations_v2')
      .select('id, category, severity, description, created_at')
      .eq('tenant_id', tenant.id)
      .eq('observer_user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (err) { setError(err.message); setRows(null); return }
    setRows((data ?? []) as ObservationListRow[])
  }, [tenant?.id, userId])

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
        <Centered><Text style={formStyles.empty}>You haven't logged any observations yet.</Text></Centered>
      ) : (
        <FlatList
          data={rows ?? []}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          renderItem={({ item }) => (
            <View style={[formStyles.card, styles.row]}>
              <Text style={formStyles.rowTitle} numberOfLines={2}>{item.description}</Text>
              <Text style={formStyles.rowMeta}>
                {CATEGORY_LABEL[item.category]}{item.severity ? ` · ${item.severity}` : ''} · {formatShortDateTime(item.created_at)}
              </Text>
            </View>
          )}
        />
      )}
      <Link href="/bbs/new" asChild>
        <Pressable accessibilityRole="button">
          {({ pressed }) => (
            <View style={[formStyles.fab, pressed && { opacity: 0.85 }]}>
              <Text style={formStyles.fabText}>+ Observe</Text>
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
