import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
} from 'react-native'

import { Text, View } from '@/components/Themed'
import PhotoCaptureSheet from '@/components/PhotoCaptureSheet'
import { supabase } from '@/lib/supabase'
import { loadEquipment } from '@soteria/core/queries/equipment'
import type { PhotoSlot } from '@soteria/core/storagePaths'
import type { Equipment, LotoEnergyStep } from '@soteria/core/types'

// Phase 3 equipment detail. Equipment row + energy steps via parallel
// fetch (same data the web placard uses). Photos are tappable to
// launch <PhotoCaptureSheet> for capture-or-pick + upload through the
// shared @soteria/core/photoUpload pipeline.

export default function EquipmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const equipmentId = Array.isArray(id) ? id[0] : id

  const [equipment, setEquipment] = useState<Equipment | null>(null)
  const [steps,     setSteps]     = useState<LotoEnergyStep[]>([])
  const [error,     setError]     = useState<string | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [captureSlot, setCaptureSlot] = useState<PhotoSlot | null>(null)

  useEffect(() => {
    if (!equipmentId) return
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        // Run both fetches in parallel; the steps table can be empty
        // for equipment that hasn't had its procedure documented yet.
        const [eq, stepsRes] = await Promise.all([
          loadEquipment(equipmentId!),
          supabase
            .from('loto_steps')
            .select('*')
            .eq('equipment_id', equipmentId!)
            .order('step_number', { ascending: true }),
        ])
        if (cancelled) return
        if (stepsRes.error) throw new Error(stepsRes.error.message)
        setEquipment(eq)
        setSteps((stepsRes.data ?? []) as LotoEnergyStep[])
      } catch (e: unknown) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [equipmentId])

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
      </View>
    )
  }

  if (!equipment) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Equipment not found</Text>
        <Text style={styles.errorBody}>{equipmentId}</Text>
      </View>
    )
  }

  return (
    <>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.idTitle}>{equipment.equipment_id}</Text>
      <Text style={styles.description}>{equipment.description}</Text>
      <View style={styles.row}>
        <Badge label="Department">{equipment.department}</Badge>
        <Badge label="Status" intent={equipment.photo_status}>
          {equipment.photo_status}
        </Badge>
      </View>

      <Section title="Equipment photo">
        <PhotoBlock
          url={equipment.equip_photo_url}
          placeholder="No equipment photo yet"
          onPress={() => setCaptureSlot('EQUIP')}
        />
      </Section>

      <Section title="Isolation photo">
        <PhotoBlock
          url={equipment.iso_photo_url}
          placeholder="No isolation photo yet"
          onPress={() => setCaptureSlot('ISO')}
        />
      </Section>

      <Section title="Energy steps">
        {steps.length === 0 ? (
          <Text style={styles.muted}>No isolation procedure documented for this equipment.</Text>
        ) : (
          steps.map((s) => (
            <View key={s.id} style={styles.stepCard}>
              <View style={styles.stepHeaderRow}>
                <Text style={styles.stepNumber}>Step {s.step_number}</Text>
                <Text style={styles.stepEnergy}>{s.energy_type}</Text>
              </View>
              {s.tag_description ? <Text style={styles.stepText}>{s.tag_description}</Text> : null}
              {s.isolation_procedure ? (
                <>
                  <Text style={styles.stepLabel}>Isolation</Text>
                  <Text style={styles.stepText}>{s.isolation_procedure}</Text>
                </>
              ) : null}
              {s.method_of_verification ? (
                <>
                  <Text style={styles.stepLabel}>Verification</Text>
                  <Text style={styles.stepText}>{s.method_of_verification}</Text>
                </>
              ) : null}
            </View>
          ))
        )}
      </Section>

      <Section title="Verification">
        <Text style={styles.metaLine}>
          Verified: <Text style={styles.metaValue}>{equipment.verified ? 'Yes' : 'No'}</Text>
        </Text>
        {equipment.verified_date ? (
          <Text style={styles.metaLine}>
            Date: <Text style={styles.metaValue}>{equipment.verified_date}</Text>
          </Text>
        ) : null}
        {equipment.verified_by ? (
          <Text style={styles.metaLine}>
            By: <Text style={styles.metaValue}>{equipment.verified_by}</Text>
          </Text>
        ) : null}
      </Section>

      <Section title="Notes">
        {equipment.notes
          ? <Text style={styles.notesText}>{equipment.notes}</Text>
          : <Text style={styles.muted}>No notes.</Text>}
      </Section>

      <View style={styles.footerSpacer} />
    </ScrollView>
    <PhotoCaptureSheet
      visible={captureSlot !== null}
      equipmentId={equipment.equipment_id}
      slot={captureSlot ?? 'EQUIP'}
      onClose={() => setCaptureSlot(null)}
      onUploaded={(url) => {
        // Optimistic write so the user sees the new photo without
        // a full refetch. The shared upload pipeline already
        // persisted it server-side.
        setEquipment(prev => {
          if (!prev) return prev
          return captureSlot === 'EQUIP'
            ? { ...prev, equip_photo_url: url, has_equip_photo: true }
            : { ...prev, iso_photo_url:   url, has_iso_photo:   true }
        })
      }}
    />
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Badge({ label, intent, children }: { label: string; intent?: string; children: React.ReactNode }) {
  const tint = intent === 'complete' ? '#10b981'
             : intent === 'partial'  ? '#f59e0b'
             : intent === 'missing'  ? '#ef4444'
             : undefined
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeLabel}>{label}</Text>
      <Text style={[styles.badgeValue, tint ? { color: tint } : undefined]}>{children}</Text>
    </View>
  )
}

function PhotoBlock({ url, placeholder, onPress }: { url: string | null; placeholder: string; onPress: () => void }) {
  const [loaded, setLoaded] = useState(false)
  if (!url) {
    return (
      <Pressable onPress={onPress}>
        {({ pressed }) => (
          <View style={[styles.photoPlaceholder, pressed && styles.photoPressed]}>
            <Text style={styles.muted}>{placeholder}</Text>
            <Text style={styles.photoCta}>Tap to add</Text>
          </View>
        )}
      </Pressable>
    )
  }
  return (
    <Pressable onPress={onPress}>
      {({ pressed }) => (
        <View style={[styles.photoFrame, pressed && styles.photoPressed]}>
          {!loaded && <ActivityIndicator style={styles.photoLoader} />}
          <Image
            source={{ uri: url }}
            style={styles.photo}
            resizeMode="cover"
            onLoadEnd={() => setLoaded(true)}
          />
          <View style={styles.photoReplaceBadge}>
            <Text style={styles.photoReplaceText}>Tap to replace</Text>
          </View>
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  scroll:           { flex: 1 },
  scrollContent:    { padding: 16, gap: 14 },
  center:           { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 8 },
  errorText:        { fontSize: 16, fontWeight: '600' },
  errorBody:        { fontSize: 12, opacity: 0.6, textAlign: 'center' },
  muted:            { fontSize: 13, opacity: 0.55 },
  idTitle:          { fontSize: 24, fontWeight: '700' },
  description:      { fontSize: 15, opacity: 0.8 },
  row:              { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 4 },
  badge:            { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  badgeLabel:       { fontSize: 9, fontWeight: '600', opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.5 },
  badgeValue:       { fontSize: 13, fontWeight: '600', marginTop: 2 },
  section:          { marginTop: 12, gap: 8 },
  sectionTitle:     { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.55 },
  photoFrame:        { borderRadius: 12, overflow: 'hidden', backgroundColor: '#0f172a' },
  photoPlaceholder:  { borderRadius: 12, paddingVertical: 28, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: '#cbd5e1', borderStyle: 'dashed' },
  photoPressed:      { opacity: 0.7 },
  photoCta:          { fontSize: 12, fontWeight: '600', color: '#1e3a8a' },
  photoReplaceBadge: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(15, 23, 42, 0.7)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  photoReplaceText:  { fontSize: 11, fontWeight: '600', color: '#fff' },
  photo:             { width: '100%', aspectRatio: 4 / 3 },
  photoLoader:       { position: 'absolute', top: '50%', left: '50%' },
  stepCard:         { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', gap: 4 },
  stepHeaderRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  stepNumber:       { fontSize: 13, fontWeight: '700' },
  stepEnergy:       { fontSize: 11, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.5 },
  stepLabel:        { fontSize: 10, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 },
  stepText:         { fontSize: 13, lineHeight: 18 },
  metaLine:         { fontSize: 13, opacity: 0.75 },
  metaValue:        { fontWeight: '600', opacity: 1 },
  notesText:        { fontSize: 13, lineHeight: 19 },
  footerSpacer:     { height: 32 },
})
