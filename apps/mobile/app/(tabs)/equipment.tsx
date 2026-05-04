import { Link } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
} from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { loadAllEquipment } from '@soteria/core/queries/equipment'
import type { Equipment } from '@soteria/core/types'

// Phase 3 equipment list. Uses the shared @soteria/core query layer
// so the data shape + RLS scoping match exactly what the web app
// gets — switching tenants on the dashboard re-keys this screen via
// `tenantId` and a fresh load fires.
//
// Search is client-side: the typical tenant has < 2,000 equipment
// rows, so filtering in JS is faster than a debounced PostgREST
// round-trip. If the row count grows past ~5k we'll switch to
// `.ilike` server-side.

export default function EquipmentListScreen() {
  const { tenantId } = useTenant()
  const [items,    setItems]    = useState<Equipment[] | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query,    setQuery]    = useState('')

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    else                    setRefreshing(true)
    setError(null)
    try {
      const rows = await loadAllEquipment()
      setItems(rows)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!tenantId) return
    void load('initial')
  }, [tenantId, load])

  const filtered = useMemo(() => {
    if (!items) return []
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(e =>
      e.equipment_id.toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q) ||
      e.department.toLowerCase().includes(q),
    )
  }, [items, query])

  if (!tenantId) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>No tenant selected. Open the dashboard to pick one.</Text>
      </View>
    )
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    )
  }

  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn’t load equipment</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable onPress={() => void load('initial')} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search by tag, description, or department"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.equipment_id}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>
              {query ? 'No equipment matches your search.' : 'No equipment for this tenant yet.'}
            </Text>
          </View>
        }
        ListHeaderComponent={
          filtered.length > 0
            ? <Text style={styles.countLabel}>{filtered.length} {filtered.length === 1 ? 'item' : 'items'}</Text>
            : null
        }
        renderItem={({ item }) => <EquipmentRow item={item} />}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />
        }
        contentContainerStyle={filtered.length === 0 ? styles.flexFill : undefined}
      />
    </View>
  )
}

function EquipmentRow({ item }: { item: Equipment }) {
  const status = item.photo_status
  return (
    <Link href={{ pathname: '/equipment/[id]', params: { id: item.equipment_id } }} asChild>
      <Pressable>
        {({ pressed }) => (
          <View style={[styles.row, pressed && styles.rowPressed]}>
            <View style={[styles.statusDot, statusDotStyle(status)]} />
            <View style={styles.rowBody}>
              <Text style={styles.rowId}>{item.equipment_id}</Text>
              <Text style={styles.rowDesc} numberOfLines={1}>{item.description}</Text>
              <Text style={styles.rowMeta}>{item.department}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </View>
        )}
      </Pressable>
    </Link>
  )
}

function statusDotStyle(status: Equipment['photo_status']) {
  switch (status) {
    case 'complete': return { backgroundColor: '#10b981' }
    case 'partial':  return { backgroundColor: '#f59e0b' }
    case 'missing':  return { backgroundColor: '#ef4444' }
  }
}

const styles = StyleSheet.create({
  container:     { flex: 1 },
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 8 },
  flexFill:      { flexGrow: 1 },
  muted:         { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  errorText:     { fontSize: 16, fontWeight: '600' },
  errorBody:     { fontSize: 12, opacity: 0.6, textAlign: 'center' },
  retryBtn:      { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8' },
  retryText:     { fontSize: 14, fontWeight: '600' },
  searchRow:     { padding: 12 },
  search:        { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  countLabel:    { fontSize: 11, opacity: 0.5, paddingHorizontal: 12, paddingVertical: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  row:           { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },
  rowPressed:    { opacity: 0.6 },
  statusDot:     { width: 10, height: 10, borderRadius: 5 },
  rowBody:       { flex: 1, gap: 1 },
  rowId:         { fontSize: 14, fontWeight: '600' },
  rowDesc:       { fontSize: 13, opacity: 0.8 },
  rowMeta:       { fontSize: 11, opacity: 0.5, marginTop: 1 },
  chevron:       { fontSize: 22, opacity: 0.3, marginLeft: 4 },
})
