import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect, useMemo, useRef, useState } from 'react'
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

// Free-text length caps. Hard limits at the input layer so a long paste
// can't blow past AsyncStorage's per-key practical ceiling and so the
// observation field can't accidentally grow into a multi-MB blob.
const MAX_LOCATION_CHARS    = 120
const MAX_CONTAINER_CHARS   = 80
const MAX_WASTE_DESC_CHARS  = 200
const MAX_OBSERVATION_CHARS = 2000

// AsyncStorage replaces expo-secure-store for this screen: SecureStore on
// iOS is a Keychain item (~2 KB per value), too small for a draft with
// observation text. AsyncStorage is the right primitive for non-secret,
// per-tenant JSON blobs.
function storageKey(tenantId: string): string {
  return `soteria.hazardousWaste.fieldDraft.v1.${tenantId}`
}

export default function HazardousWasteFieldScreen() {
  const { tenant } = useTenant()
  const [draft, setDraft] = useState<HazardousWasteFieldDraft>(() => createEmptyHazardousWasteFieldDraft())
  const [loaded, setLoaded] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Tracks whether the user has typed/touched anything since the last
  // load or save. Lets us warn before a tenant switch wipes the draft.
  const [dirty, setDirty] = useState(false)
  const prevTenantId = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function loadDraft() {
      setLoaded(false)
      setSaveError(null)

      // No active tenant → nothing to load. We refuse to share a draft
      // across "unauthenticated" sessions because two different users on
      // the same device would collide on a single key.
      if (!tenant?.id) {
        setDraft(createEmptyHazardousWasteFieldDraft())
        setSavedAt(null)
        setDirty(false)
        setLoaded(true)
        prevTenantId.current = null
        return
      }

      const raw = await AsyncStorage.getItem(storageKey(tenant.id)).catch(() => null)
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
      setDirty(false)
      setLoaded(true)
      prevTenantId.current = tenant.id
    }

    // If a switch is happening while the previous tenant's draft is
    // dirty, warn the operator before we overwrite local state with
    // the new tenant's draft. The current draft stays in memory while
    // we wait for the choice — no auto-save, no silent loss.
    const isSwitch = prevTenantId.current !== null && tenant?.id !== prevTenantId.current
    if (isSwitch && dirty) {
      Alert.alert(
        'Switch tenant?',
        'You have unsaved changes on this device. Switching tenants will hide them until you switch back. Save first or continue without saving.',
        [
          { text: 'Continue without saving', style: 'destructive', onPress: () => { void loadDraft() } },
          { text: 'Stay on previous tenant', style: 'cancel' },
        ],
      )
      return () => { cancelled = true }
    }

    void loadDraft()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id])

  const checks = useMemo(() => getChecksForArea(draft.areaType), [draft.areaType])
  const summary = useMemo(() => summarizeHazardousWasteDraft(draft), [draft])

  function updateDraft(patch: Partial<HazardousWasteFieldDraft>) {
    setDraft(current => ({ ...current, ...patch, updatedAt: new Date().toISOString() }))
    setDirty(true)
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
    if (!tenant?.id) {
      // Refuse to persist without a tenant. The previous code wrote
      // to a shared "no-tenant" bucket where two unauthenticated users
      // on the same device would collide.
      setSaveError('Sign in and confirm the active tenant before saving the draft.')
      return
    }
    const next = { ...draft, updatedAt: new Date().toISOString() }
    try {
      await AsyncStorage.setItem(storageKey(tenant.id), JSON.stringify(next))
      setDraft(next)
      setSavedAt(next.updatedAt)
      setSaveError(null)
      setDirty(false)
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
          setDirty(false)
          if (tenant?.id) {
            void AsyncStorage.removeItem(storageKey(tenant.id))
          }
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
          maxLength={MAX_LOCATION_CHARS}
        />
        <TextInput
          style={styles.input}
          value={draft.containerLabel}
          onChangeText={containerLabel => updateDraft({ containerLabel })}
          placeholder="Container label or ID"
          placeholderTextColor="#64748b"
          maxLength={MAX_CONTAINER_CHARS}
        />
        <TextInput
          style={styles.input}
          value={draft.wasteDescription}
          onChangeText={wasteDescription => updateDraft({ wasteDescription })}
          placeholder="Waste description"
          placeholderTextColor="#64748b"
          maxLength={MAX_WASTE_DESC_CHARS}
        />
        <TextInput
          style={[styles.input, styles.textArea]}
          multiline
          value={draft.observations}
          onChangeText={observations => updateDraft({ observations })}
          placeholder="Observations, corrective actions, or follow-up needed"
          placeholderTextColor="#64748b"
          maxLength={MAX_OBSERVATION_CHARS}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Checks</Text>
        {checks.map(check => {
          const checked = draft.checkedIds.includes(check.id)
          const flagged = draft.flaggedIds.includes(check.id)
          return (
            <View
              key={check.id}
              style={[
                styles.checkRow,
                check.critical && styles.checkRowCritical,
                flagged && styles.checkRowFlagged,
              ]}
            >
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
  checkRowCritical:   { borderLeftWidth: 4, borderLeftColor: '#b45309' },
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
