import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput } from 'react-native'

import { ChipSelect, ErrorBanner, Field, PrimaryButton, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  BEHAVIOR_TAG_CATALOG,
  type BehaviorTag,
  type ObservationCategory,
} from '@soteria/core/bbsMetricsV2'

// One-handed BBS observation capture. Writes bbs_observations_v2 directly,
// column for column what apps/web/app/bbs/observe/page.tsx writes, so the two
// clients produce identical rows. The observed-worker and action-team pickers
// are web-only for now.

type Severity = 'minor' | 'major' | 'critical'
type HierarchyLevel = 'eliminate' | 'substitute' | 'engineering' | 'administrative' | 'ppe'

const CATEGORIES: readonly ObservationCategory[] = ['safe_behavior', 'unsafe_act', 'unsafe_condition']
const CATEGORY_LABEL: Record<ObservationCategory, string> = {
  safe_behavior:    'Safe behavior',
  unsafe_act:       'Unsafe act',
  unsafe_condition: 'Unsafe condition',
}
const SEVERITIES: readonly Severity[] = ['minor', 'major', 'critical']
const HIERARCHY: readonly HierarchyLevel[] = ['eliminate', 'substitute', 'engineering', 'administrative', 'ppe']
const MIN_DESCRIPTION_CHARS = 5

export default function NewObservationScreen() {
  return (
    <ModuleGate featureId="bbs" name="Behavior observations">
      <ObservationForm />
    </ModuleGate>
  )
}

function ObservationForm() {
  const { tenant } = useTenant()
  const { userId } = useAuth()

  const [category, setCategory] = useState<ObservationCategory | ''>('')
  const [severity, setSeverity] = useState<Severity>('minor')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')
  const [recommendation, setRecommendation] = useState('')
  const [hierarchy, setHierarchy] = useState<HierarchyLevel | ''>('')
  const [feedbackGiven, setFeedbackGiven] = useState(false)
  const [coachingNotes, setCoachingNotes] = useState('')
  const [followUp, setFollowUp] = useState(false)
  const [tags, setTags] = useState<ReadonlySet<BehaviorTag>>(new Set())
  const [recognized, setRecognized] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedCount, setSavedCount] = useState(0)

  const isSafe = category === 'safe_behavior'
  // Critical unsafe observations trigger the 24-hour rapid review on web too.
  const rapidReview = category !== '' && !isSafe && severity === 'critical'

  function toggleTag(tag: BehaviorTag) {
    setTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function reset() {
    setCategory(''); setSeverity('minor'); setLocation(''); setDescription('')
    setRecommendation(''); setHierarchy(''); setFeedbackGiven(false); setCoachingNotes('')
    setFollowUp(false); setTags(new Set()); setRecognized(false)
  }

  async function onSubmit() {
    if (!tenant?.id || !userId) { setError('Sign in and select a workspace first.'); return }
    if (!category) { setError('Pick a category.'); return }
    if (description.trim().length < MIN_DESCRIPTION_CHARS) {
      setError(`Describe what you observed (at least ${MIN_DESCRIPTION_CHARS} characters).`)
      return
    }
    setBusy(true); setError(null)
    const { error: insertError } = await supabase.from('bbs_observations_v2').insert({
      tenant_id:              tenant.id,
      observer_user_id:       userId,
      location_text:          location.trim() || null,
      category,
      severity,
      description:            description.trim(),
      control_recommendation: recommendation.trim() || null,
      hierarchy_level:        hierarchy || null,
      feedback_given_at:      feedbackGiven ? new Date().toISOString() : null,
      coaching_notes:         feedbackGiven && coachingNotes.trim() ? coachingNotes.trim() : null,
      follow_up_required:     followUp,
      behavior_tags:          isSafe && tags.size > 0 ? [...tags] : null,
      // DB CHECK: recognition applies to safe behaviors only.
      recognized:             isSafe && recognized,
      rapid_review_required:  rapidReview,
    })
    setBusy(false)
    if (insertError) { setError(insertError.message); return }
    setSavedCount(n => n + 1)
    reset()
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={formStyles.subtitle}>
          Quick capture: many small observations beat a few exhaustive ones.
        </Text>
        {savedCount > 0 ? (
          <View style={styles.saved}>
            <Text style={styles.savedText}>Observation logged ({savedCount} this session). Capture another or go back.</Text>
          </View>
        ) : null}
        <ErrorBanner message={error} />

        <Field label="Category" required>
          <ChipSelect options={CATEGORIES} value={category} onChange={setCategory} labelFor={c => CATEGORY_LABEL[c]} />
        </Field>

        <Field label="Severity">
          <ChipSelect options={SEVERITIES} value={severity} onChange={setSeverity} />
        </Field>

        <Field label="What did you observe?" required>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the behavior or condition."
            placeholderTextColor="#94a3b8"
            multiline
            style={[formStyles.input, formStyles.multiline]}
          />
        </Field>

        <Field label="Location">
          <TextInput value={location} onChangeText={setLocation} placeholder="e.g. Dock B" placeholderTextColor="#94a3b8" style={formStyles.input} />
        </Field>

        {isSafe ? (
          <>
            <Field label="Safe behavior areas" hint="Optional">
              <View style={styles.tagRow}>
                {BEHAVIOR_TAG_CATALOG.map(tag => {
                  const active = tags.has(tag.key)
                  return (
                    <Pressable key={tag.key} onPress={() => toggleTag(tag.key)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                      <View style={[styles.tag, active && styles.tagActive]}>
                        <Text style={[styles.tagText, active && styles.tagTextActive]}>{tag.label}</Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </Field>
            <ToggleRow label="Recognize this worker" value={recognized} onChange={setRecognized} />
          </>
        ) : category ? (
          <>
            <Field label="Recommended control" hint="Optional">
              <TextInput
                value={recommendation}
                onChangeText={setRecommendation}
                placeholder="What would fix it?"
                placeholderTextColor="#94a3b8"
                multiline
                style={[formStyles.input, formStyles.multiline]}
              />
            </Field>
            <Field label="Control level" hint="Hierarchy of controls">
              <ChipSelect options={HIERARCHY} value={hierarchy} onChange={setHierarchy} />
            </Field>
          </>
        ) : null}

        <ToggleRow label="I gave feedback in the moment" value={feedbackGiven} onChange={setFeedbackGiven} />
        {feedbackGiven ? (
          <Field label="Coaching notes">
            <TextInput value={coachingNotes} onChangeText={setCoachingNotes} multiline style={[formStyles.input, formStyles.multiline]} placeholderTextColor="#94a3b8" />
          </Field>
        ) : null}
        <ToggleRow label="Follow-up needed" value={followUp} onChange={setFollowUp} />

        {rapidReview ? (
          <View style={styles.rapid}>
            <Text style={styles.rapidText}>Critical unsafe observations go to rapid review within 24 hours.</Text>
          </View>
        ) : null}

        <PrimaryButton label="Log observation" onPress={onSubmit} busy={busy} />
        <Pressable onPress={() => router.back()} accessibilityRole="button">
          <Text style={styles.back}>Done</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (next: boolean) => void }) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  saved: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#6EE7B7', backgroundColor: '#D1FAE5' },
  savedText: { color: '#064E3B', fontSize: 13 },
  rapid: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FEF3C7' },
  rapidText: { color: '#78350F', fontSize: 13 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1' },
  tagActive: { borderColor: '#047857', backgroundColor: '#047857' },
  tagText: { fontSize: 12 },
  tagTextActive: { color: '#fff', fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  toggleLabel: { fontSize: 14, flexShrink: 1 },
  back: { textAlign: 'center', fontSize: 14, fontWeight: '600', color: '#1e3a8a', paddingVertical: 8 },
})
