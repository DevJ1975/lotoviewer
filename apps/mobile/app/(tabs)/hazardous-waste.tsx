import * as SecureStore from 'expo-secure-store'
import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import {
  createEmptyHazardousWasteFieldDraft,
  getChecksForArea,
  HAZARDOUS_WASTE_AREA_LABEL,
  HAZARDOUS_WASTE_CALENDAR,
  HAZARDOUS_WASTE_DOCUMENT_PACKETS,
  summarizeHazardousWasteDraft,
  type HazardousWasteAreaType,
  type HazardousWasteFieldDraft,
} from '@soteria/core/hazardousWaste'

const AREA_TYPES: HazardousWasteAreaType[] = [
  'satellite_accumulation',
  'central_accumulation',
  'universal_waste',
  'used_oil',
  'inspection_only',
]

function storageKey(tenantId: string | null | undefined): string {
  return `soteria.hazardousWaste.fieldDraft.v1.${tenantId ?? 'no-tenant'}`
}

export default function HazardousWasteFieldScreen() {
  const { tenant } = useTenant()
  const [draft, setDraft] = useState<HazardousWasteFieldDraft>(() => createEmptyHazardousWasteFieldDraft())
  const [loaded, setLoaded] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadDraft() {
      setLoaded(false)
      setSaveError(null)
      const raw = await SecureStore.getItemAsync(storageKey(tenant?.id)).catch(() => null)
      if (cancelled) return
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as HazardousWasteFieldDraft
          setDraft(parsed)
          setSavedAt(parsed.updatedAt)
        } catch {
          setDraft(createEmptyHazardousWasteFieldDraft())
          setSavedAt(null)
        }
      } else {
        setDraft(createEmptyHazardousWasteFieldDraft())
        setSavedAt(null)
      }
      setLoaded(true)
    }
    void loadDraft()
    return () => { cancelled = true }
  }, [tenant?.id])

  const checks = useMemo(() => getChecksForArea(draft.areaType), [draft.areaType])
  const summary = useMemo(() => summarizeHazardousWasteDraft(draft), [draft])

  function updateDraft(patch: Partial<HazardousWasteFieldDraft>) {
    setDraft(current => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
    setSaveError(null)
  }

  function setAreaType(areaType: HazardousWasteAreaType) {
    const allowed = new Set(getChecksForArea(areaType).map(check => check.id))
    updateDraft({
      areaType,
      checkedIds: draft.checkedIds.filter(id => allowed.has(id)),
      flaggedIds: draft.flaggedIds.filter(id => allowed.has(id)),
    })
  }

  function toggleChecked(id: string) {
    const exists = draft.checkedIds.includes(id)
    updateDraft({
      checkedIds: exists
        ? draft.checkedIds.filter(value => value !== id)
        : [...draft.checkedIds, id],
    })
  }

  function toggleFlagged(id: string) {
    const exists = draft.flaggedIds.includes(id)
    updateDraft({
      flaggedIds: exists
        ? draft.flaggedIds.filter(value => value !== id)
        : [...draft.flaggedIds, id],
    })
  }

  async function saveDraft() {
    const next = { ...draft, updatedAt: new Date().toISOString() }
    try {
      await SecureStore.setItemAsync(storageKey(tenant?.id), JSON.stringify(next))
      setDraft(next)
      setSavedAt(next.updatedAt)
      setSaveError(null)
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save field draft on this device.')
    }
  }

  function confirmClear() {
    Alert.alert('Clear field draft?', 'This removes the local offline draft from this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          const next = createEmptyHazardousWasteFieldDraft(draft.areaType)
          setDraft(next)
          setSavedAt(null)
          setSaveError(null)
          void SecureStore.deleteItemAsync(storageKey(tenant?.id))
        },
      },
    ])
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Offline field module</Text>
        <Text style={styles.title}>Hazardous Waste</Text>
        <Text style={styles.subtitle}>
          Bundled accumulation checks, document reminders, and a local field draft for weak-signal areas.
        </Text>
      </View>

      <View style={[styles.statusPanel, summary.flaggedCritical > 0 ? styles.statusPanelBlocked : styles.statusPanelReady]}>
        <Text style={styles.statusLabel}>{loaded ? 'Local draft ready' : 'Loading local draft'}</Text>
        <Text style={styles.statusValue}>
          {summary.checked}/{summary.total} checks complete
        </Text>
        <Text style={styles.statusMeta}>
          {summary.flaggedCritical > 0
            ? `${summary.flaggedCritical} critical item${summary.flaggedCritical === 1 ? '' : 's'} flagged`
            : 'No critical flags in this draft'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Area type</Text>
        <View style={styles.segmentWrap}>
          {AREA_TYPES.map(areaType => {
            const active = areaType === draft.areaType
            return (
              <Pressable key={areaType} onPress={() => setAreaType(areaType)}>
                {({ pressed }) => (
                  <View style={[styles.segment, active && styles.segmentActive, pressed && styles.pressed]}>
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                      {HAZARDOUS_WASTE_AREA_LABEL[areaType]}
                    </Text>
                  </View>
                )}
              </Pressable>
            )
          })}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Field draft</Text>
        <TextInput
          style={styles.input}
          value={draft.locationName}
          onChangeText={locationName => updateDraft({ locationName })}
          placeholder="Location or accumulation area"
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={styles.input}
          value={draft.containerLabel}
          onChangeText={containerLabel => updateDraft({ containerLabel })}
          placeholder="Container label or ID"
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={styles.input}
          value={draft.wasteDescription}
          onChangeText={wasteDescription => updateDraft({ wasteDescription })}
          placeholder="Waste description"
          placeholderTextColor="#64748b"
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          multiline
          value={draft.observations}
          onChangeText={observations => updateDraft({ observations })}
          placeholder="Observations, corrective actions, or follow-up needed"
          placeholderTextColor="#64748b"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Checks</Text>
        {checks.map(check => {
          const checked = draft.checkedIds.includes(check.id)
          const flagged = draft.flaggedIds.includes(check.id)
          return (
            <View key={check.id} style={[styles.checkRow, flagged && styles.checkRowFlagged]}>
              <Pressable onPress={() => toggleChecked(check.id)} style={styles.checkMain}>
                {({ pressed }) => (
                  <>
                    <View style={[styles.checkbox, checked && styles.checkboxOn, pressed && styles.pressed]}>
                      <Text style={styles.checkboxText}>{checked ? '✓' : ''}</Text>
                    </View>
                    <View style={styles.checkTextWrap}>
                      <Text style={styles.checkLabel}>{check.label}</Text>
                      <Text style={styles.checkDetail}>{check.detail}</Text>
                    </View>
                  </>
                )}
              </Pressable>
              <Pressable onPress={() => toggleFlagged(check.id)}>
                {({ pressed }) => (
                  <View style={[styles.flagButton, flagged && styles.flagButtonOn, pressed && styles.pressed]}>
                    <Text style={[styles.flagText, flagged && styles.flagTextOn]}>
                      {flagged ? 'Flagged' : check.critical ? 'Critical' : 'Flag'}
                    </Text>
                  </View>
                )}
              </Pressable>
            </View>
          )
        })}
      </View>

      <View style={styles.actions}>
        <Pressable onPress={saveDraft}>
          {({ pressed }) => (
            <View style={[styles.primaryButton, pressed && styles.pressed]}>
              <Text style={styles.primaryButtonText}>Save offline draft</Text>
            </View>
          )}
        </Pressable>
        <Pressable onPress={confirmClear}>
          {({ pressed }) => (
            <View style={[styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonText}>Clear</Text>
            </View>
          )}
        </Pressable>
      </View>
      {saveError && <Text style={styles.errorText}>{saveError}</Text>}
      {savedAt && <Text style={styles.savedText}>Saved on this device {new Date(savedAt).toLocaleString()}</Text>}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Key calendar</Text>
        {HAZARDOUS_WASTE_CALENDAR.slice(0, 4).map(item => (
          <View key={item.id} style={styles.referenceRow}>
            <Text style={styles.referenceTitle}>{item.title}</Text>
            <Text style={styles.referenceBody}>{item.dueRule}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Document packets</Text>
        {HAZARDOUS_WASTE_DOCUMENT_PACKETS.slice(0, 3).map(packet => (
          <View key={packet.id} style={styles.referenceRow}>
            <Text style={styles.referenceTitle}>{packet.title}</Text>
            <Text style={styles.referenceBody}>{packet.caution}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container:          { flex: 1 },
  content:            { padding: 16, paddingBottom: 40, gap: 16 },
  header:             { gap: 4 },
  eyebrow:            { fontSize: 11, fontWeight: '700', color: '#b45309', textTransform: 'uppercase', letterSpacing: 0.5 },
  title:              { fontSize: 24, fontWeight: '800' },
  subtitle:           { fontSize: 13, opacity: 0.68, lineHeight: 18 },
  statusPanel:        { borderRadius: 12, borderWidth: 1, padding: 14, gap: 4 },
  statusPanelReady:   { borderColor: '#86efac', backgroundColor: '#dcfce7' },
  statusPanelBlocked: { borderColor: '#fca5a5', backgroundColor: '#fee2e2' },
  statusLabel:        { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', color: '#334155' },
  statusValue:        { fontSize: 22, fontWeight: '800', color: '#0f172a' },
  statusMeta:         { fontSize: 12, color: '#334155' },
  section:            { gap: 10 },
  sectionTitle:       { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', color: '#475569' },
  segmentWrap:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segment:            { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  segmentActive:      { backgroundColor: '#92400e', borderColor: '#92400e' },
  segmentText:        { fontSize: 12, fontWeight: '600' },
  segmentTextActive:  { color: '#fff' },
  input:              { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: '#0f172a', backgroundColor: '#fff' },
  textArea:           { minHeight: 88, textAlignVertical: 'top' },
  checkRow:           { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 12, padding: 10, gap: 10, backgroundColor: '#fff' },
  checkRowFlagged:    { borderColor: '#f97316', backgroundColor: '#fff7ed' },
  checkMain:          { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  checkbox:           { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  checkboxOn:         { borderColor: '#15803d', backgroundColor: '#15803d' },
  checkboxText:       { color: '#fff', fontSize: 16, fontWeight: '800' },
  checkTextWrap:      { flex: 1, gap: 2 },
  checkLabel:         { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  checkDetail:        { fontSize: 12, color: '#475569', lineHeight: 17 },
  flagButton:         { alignSelf: 'flex-start', borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  flagButtonOn:       { borderColor: '#c2410c', backgroundColor: '#c2410c' },
  flagText:           { fontSize: 11, fontWeight: '700', color: '#475569' },
  flagTextOn:         { color: '#fff' },
  actions:            { flexDirection: 'row', gap: 10 },
  primaryButton:      { backgroundColor: '#1e3a8a', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  primaryButtonText:  { color: '#fff', fontWeight: '800', fontSize: 13 },
  secondaryButton:    { borderWidth: 1, borderColor: '#94a3b8', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11 },
  secondaryButtonText:{ color: '#334155', fontWeight: '800', fontSize: 13 },
  errorText:          { color: '#b91c1c', fontSize: 12 },
  savedText:          { color: '#475569', fontSize: 12 },
  referenceRow:       { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 11, gap: 3, backgroundColor: '#fff' },
  referenceTitle:     { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  referenceBody:      { fontSize: 12, color: '#475569', lineHeight: 17 },
  pressed:            { opacity: 0.65 },
})
