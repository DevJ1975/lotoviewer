import { router, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet } from 'react-native'

import { Centered, ErrorBanner, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { formatShortDateTime } from '@/lib/dateFormat'
import {
  listInspections,
  startInspection,
  type InspectionSummary,
  type InspectionTemplateSummary,
} from '@/lib/inspections'

export default function InspectionsScreen() {
  return (
    <ModuleGate featureId="inspections" name="Inspections">
      <InspectionList />
    </ModuleGate>
  )
}

function InspectionList() {
  const { tenant } = useTenant()
  const [inspections, setInspections] = useState<InspectionSummary[] | null>(null)
  const [templates, setTemplates] = useState<InspectionTemplateSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) { setInspections([]); return }
    setError(null)
    try {
      const result = await listInspections(tenant.id)
      setInspections(result.inspections)
      setTemplates(result.templates)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load inspections.')
      setInspections(null)
    }
  }, [tenant?.id])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function onStart(templateId: string) {
    if (!tenant?.id || starting) return
    setStarting(templateId); setError(null)
    try {
      const id = await startInspection(tenant.id, templateId)
      router.push({ pathname: '/inspections/[id]', params: { id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the inspection.')
    } finally {
      setStarting(null)
    }
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.sectionTitle}>Start an inspection</Text>
      {templates.length === 0 ? (
        <Text style={formStyles.rowMeta}>No active templates. An administrator can create one on the web.</Text>
      ) : templates.map(t => (
        <Pressable key={t.id} onPress={() => onStart(t.id)} disabled={starting !== null} accessibilityRole="button">
          {({ pressed }) => (
            <View style={[formStyles.card, pressed && { opacity: 0.7 }, starting !== null && starting !== t.id && { opacity: 0.5 }]}>
              <Text style={formStyles.rowTitle}>{t.name}</Text>
              <Text style={formStyles.rowMeta}>{starting === t.id ? 'Starting…' : (t.category ?? 'General')}</Text>
            </View>
          )}
        </Pressable>
      ))}
      <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Recent</Text>
    </View>
  )

  if (inspections === null && !error) return <Centered><ActivityIndicator /></Centered>

  return (
    <View style={{ flex: 1 }}>
      <ErrorBanner message={error} />
      <FlatList
        data={inspections ?? []}
        keyExtractor={i => i.id}
        ListHeaderComponent={header}
        ListEmptyComponent={<Text style={[formStyles.empty, { padding: 16 }]}>No inspections yet.</Text>}
        contentContainerStyle={styles.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => router.push({ pathname: '/inspections/[id]', params: { id: item.id } })} accessibilityRole="button">
            {({ pressed }) => (
              <View style={[formStyles.card, styles.row, pressed && { opacity: 0.7 }]}>
                <Text style={formStyles.rowTitle}>{item.title}</Text>
                <Text style={formStyles.rowMeta}>
                  {item.status === 'submitted'
                    ? `${item.result === 'fail' ? 'Failed' : 'Passed'} · ${formatShortDateTime(item.submitted_at ?? item.started_at)}`
                    : `In progress · started ${formatShortDateTime(item.started_at)}`}
                </Text>
              </View>
            )}
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 12, paddingBottom: 32 },
  header: { gap: 8, paddingTop: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '700' },
  row: { marginVertical: 4 },
})
