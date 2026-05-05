import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  NEAR_MISS_HAZARD_CATEGORIES,
  NEAR_MISS_SEVERITY_BANDS,
  validateCreateInput,
  type NearMissHazardCategory,
  type NearMissSeverity,
} from '@soteria/core/nearMiss'

// Mobile-first capture form. Field workers tap "Report" on the
// list, fill description + severity + category in 30 seconds, hit
// Submit. Goes through the same validateCreateInput path as the
// web build so client-side errors match server-side rejections.

const SEVERITY_HELP: Record<NearMissSeverity, string> = {
  low:      'No injury possible',
  moderate: 'First-aid level injury possible',
  high:     'Lost-time injury possible',
  extreme:  'Life-threatening or fatal outcome possible',
}
const SEVERITY_BG: Record<NearMissSeverity, string> = {
  extreme: '#DC2626', high: '#F97316', moderate: '#FBBF24', low: '#10B981',
}

export default function NewNearMissScreen() {
  const { tenant } = useTenant()
  const { userId } = useAuth()

  const [description, setDescription] = useState<string>('')
  const [location,    setLocation]    = useState<string>('')
  const [immediate,   setImmediate]   = useState<string>('')
  const [hazard,      setHazard]      = useState<NearMissHazardCategory | ''>('')
  const [severity,    setSeverity]    = useState<NearMissSeverity | ''>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    if (!tenant?.id || !userId) { setError('Sign in / select a tenant first.'); return }

    const occurredIso = new Date().toISOString()
    const validationError = validateCreateInput({
      occurred_at:        occurredIso,
      description,
      hazard_category:    hazard as NearMissHazardCategory,
      severity_potential: severity as NearMissSeverity,
    })
    if (validationError) { setError(validationError); return }

    setSubmitting(true); setError(null)
    const { error: insertErr } = await supabase
      .from('near_misses')
      .insert({
        tenant_id:              tenant.id,
        reported_by:            userId,
        occurred_at:            occurredIso,
        description:            description.trim(),
        location:               location.trim() || null,
        immediate_action_taken: immediate.trim() || null,
        hazard_category:        hazard,
        severity_potential:     severity,
      })
    if (insertErr) {
      setError(insertErr.message)
      setSubmitting(false)
      return
    }
    router.replace('/(tabs)/near-miss')
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Report Near-Miss' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          An event that <Text style={styles.italic}>almost</Text> caused harm. The more detail, the better we prevent the next one.
        </Text>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        <Field label="What happened?" required>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the event in plain language."
            placeholderTextColor="#94a3b8"
            multiline
            style={[styles.input, styles.multiline]}
          />
        </Field>

        <Field label="Location">
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Loading dock B, Line 3"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </Field>

        <Field label="Hazard category" required>
          <View style={styles.chipRow}>
            {NEAR_MISS_HAZARD_CATEGORIES.map(c => (
              <Pressable key={c} onPress={() => setHazard(c)}>
                {({ pressed }) => (
                  <View style={[styles.chip, hazard === c && styles.chipActive, pressed && { opacity: 0.6 }]}>
                    <Text style={[styles.chipText, hazard === c && styles.chipTextActive]}>{c}</Text>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="Severity potential" required hint="Worst case if it had played out">
          <View style={{ gap: 8 }}>
            {NEAR_MISS_SEVERITY_BANDS.map(s => (
              <Pressable key={s} onPress={() => setSeverity(s)}>
                {({ pressed }) => (
                  <View style={[styles.sevRow, severity === s && styles.sevRowActive, pressed && { opacity: 0.6 }]}>
                    <View style={[styles.sevDot, { backgroundColor: SEVERITY_BG[s] }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.sevLabel}>{s}</Text>
                      <Text style={styles.sevHelp}>{SEVERITY_HELP[s]}</Text>
                    </View>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="Immediate action taken" hint="Optional — what was done in the moment">
          <TextInput
            value={immediate}
            onChangeText={setImmediate}
            placeholder="e.g. Stopped the line, taped off the spill."
            placeholderTextColor="#94a3b8"
            multiline
            style={[styles.input, styles.multiline]}
          />
        </Field>

        <Pressable onPress={onSubmit} disabled={submitting}>
          {({ pressed }) => (
            <View style={[styles.submitBtn, pressed && { opacity: 0.85 }, submitting && { opacity: 0.6 }]}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Submit report</Text>}
            </View>
          )}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
        <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#DC2626' }}> *</Text> : null}</Text>
        {hint && <Text style={styles.fieldHint}>{hint}</Text>}
      </View>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  content:        { padding: 16, gap: 16, paddingBottom: 32 },
  subtitle:       { fontSize: 13, opacity: 0.7 },
  italic:         { fontStyle: 'italic' },

  errorBox:       { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:      { color: '#7F1D1D', fontSize: 13 },

  fieldLabel:     { fontSize: 13, fontWeight: '600' },
  fieldHint:      { fontSize: 11, opacity: 0.5 },

  input:          { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  multiline:      { minHeight: 80, textAlignVertical: 'top' },

  chipRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip:           { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1' },
  chipActive:     { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  chipText:       { fontSize: 12, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  sevRow:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1' },
  sevRowActive:   { borderColor: '#1e3a8a', backgroundColor: 'rgba(30, 58, 138, 0.06)' },
  sevDot:         { width: 16, height: 16, borderRadius: 4 },
  sevLabel:       { fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  sevHelp:        { fontSize: 11, opacity: 0.6 },

  submitBtn:      { marginTop: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1e3a8a', alignItems: 'center' },
  submitText:     { color: '#fff', fontSize: 15, fontWeight: '700' },
})
