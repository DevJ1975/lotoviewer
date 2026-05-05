import { router, Stack } from 'expo-router'
import { useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  JHA_FREQUENCIES,
  validateJhaCreateInput,
  type JhaFrequency,
} from '@soteria/core/jha'

// Mobile JHA header create form. Identical fields + validation as
// the web /jha/new — title (required), description, location,
// performed_by, frequency (required radio cards). Steps + hazards
// + controls land on the detail page via the editor (slice 3).

const FREQ_HELP: Record<JhaFrequency, string> = {
  continuous: 'Performed continuously throughout shift',
  daily:      'Once or more per shift',
  weekly:     'Routine weekly task',
  monthly:    'Routine monthly task',
  quarterly:  'Quarterly maintenance / inspection',
  annually:   'Performed once per year',
  as_needed:  'Triggered by an event (changeover, repair)',
}

export default function NewJhaScreen() {
  const { tenant } = useTenant()
  const { userId, profile } = useAuth()
  const canCreate = !!profile?.is_admin || !!profile?.is_superadmin

  const [title,        setTitle]       = useState<string>('')
  const [description,  setDescription] = useState<string>('')
  const [location,     setLocation]    = useState<string>('')
  const [performedBy,  setPerformedBy] = useState<string>('')
  const [frequency,    setFrequency]   = useState<JhaFrequency | ''>('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canCreate) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Admins only.</Text>
      </View>
    )
  }

  async function onSubmit() {
    if (!tenant?.id || !userId) { setError('Sign in / select a tenant first.'); return }

    const validationError = validateJhaCreateInput({ title, frequency: frequency as JhaFrequency })
    if (validationError) { setError(validationError); return }

    setSubmitting(true); setError(null)
    const { data, error: insertErr } = await supabase
      .from('jhas')
      .insert({
        tenant_id:    tenant.id,
        title:        title.trim(),
        description:  description.trim() || null,
        location:     location.trim() || null,
        performed_by: performedBy.trim() || null,
        frequency,
        created_by:   userId,
        status:       'draft',
      })
      .select('id')
      .single()
    if (insertErr || !data) {
      setError(insertErr?.message ?? 'Insert failed')
      setSubmitting(false)
      return
    }
    router.replace({ pathname: '/jha/[id]', params: { id: data.id } })
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'New JHA' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Set up the header. Steps, hazards, and controls go on the detail page.
        </Text>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        <Field label="Title" required hint="A short name for the task">
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Conveyor belt changeover"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </Field>

        <Field label="Description" hint="Optional · scope, references">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Why this task gets a JHA, what it covers."
            placeholderTextColor="#94a3b8"
            multiline
            style={[styles.input, styles.multiline]}
          />
        </Field>

        <Field label="Location">
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Line 3 packaging"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </Field>

        <Field label="Performed by">
          <TextInput
            value={performedBy}
            onChangeText={setPerformedBy}
            placeholder="e.g. Maintenance crew, contractors"
            placeholderTextColor="#94a3b8"
            style={styles.input}
          />
        </Field>

        <Field label="Frequency" required hint="Drives the review cadence">
          <View style={{ gap: 8 }}>
            {JHA_FREQUENCIES.map(f => (
              <Pressable key={f} onPress={() => setFrequency(f)}>
                {({ pressed }) => (
                  <View style={[styles.freqRow, frequency === f && styles.freqRowActive, pressed && { opacity: 0.6 }]}>
                    <View style={[styles.radioOuter, frequency === f && styles.radioOuterActive]}>
                      {frequency === f && <View style={styles.radioInner} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.freqLabel}>{f.replace('_', ' ')}</Text>
                      <Text style={styles.freqHelp}>{FREQ_HELP[f]}</Text>
                    </View>
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </Field>

        <Pressable onPress={onSubmit} disabled={submitting}>
          {({ pressed }) => (
            <View style={[styles.submitBtn, pressed && { opacity: 0.85 }, submitting && { opacity: 0.6 }]}>
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Create JHA</Text>}
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
  center:         { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content:        { padding: 16, gap: 16, paddingBottom: 32 },
  subtitle:       { fontSize: 13, opacity: 0.7 },

  errorBox:       { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:      { color: '#7F1D1D', fontSize: 13 },

  fieldLabel:     { fontSize: 13, fontWeight: '600' },
  fieldHint:      { fontSize: 11, opacity: 0.5 },

  input:          { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  multiline:      { minHeight: 80, textAlignVertical: 'top' },

  freqRow:        { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1' },
  freqRowActive:  { borderColor: '#1e3a8a', backgroundColor: 'rgba(30, 58, 138, 0.06)' },
  radioOuter:     { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#94a3b8', alignItems: 'center', justifyContent: 'center' },
  radioOuterActive: { borderColor: '#1e3a8a' },
  radioInner:     { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1e3a8a' },
  freqLabel:      { fontSize: 14, fontWeight: '600', textTransform: 'capitalize' },
  freqHelp:       { fontSize: 11, opacity: 0.6 },

  submitBtn:      { marginTop: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: '#1e3a8a', alignItems: 'center' },
  submitText:     { color: '#fff', fontSize: 15, fontWeight: '700' },
})
