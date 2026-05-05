import { router, Stack } from 'expo-router'
import { useMemo, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  bandFor,
  scoreRisk,
  evaluatePpeAloneRule,
  HIERARCHY_LABELS,
  HIERARCHY_ORDER,
  type Band,
  type HierarchyLevel,
} from '@soteria/core/risk'
import type { HazardCategory } from '@soteria/core/queries/risks'

// /risk/new — single-page mobile form. The web ships an 8-step
// wizard; on iPad a single scrollable form reads better and the
// data shape is the same (POST /api/risk with { risk, controls }).
//
// PPE-alone (ISO 45001 8.1.2) surfaces as an inline warning when
// inherent_score >= 8 and every linked control is PPE-level — the
// API enforces it server-side via the migration-039 trigger; this
// form previews the rule + asks for a justification.

const HAZARD_CATEGORIES: HazardCategory[] = [
  'physical', 'chemical', 'biological', 'mechanical', 'electrical',
  'ergonomic', 'psychosocial', 'environmental', 'radiological',
]
const SOURCES = ['inspection','jsa','incident','worker_report','audit','moc','other'] as const
const ACTIVITY_TYPES = ['routine','non_routine','emergency'] as const
const EXPOSURE_FREQS = ['continuous','daily','weekly','monthly','rare'] as const
type Source       = typeof SOURCES[number]
type ActivityType = typeof ACTIVITY_TYPES[number]
type ExposureFreq = typeof EXPOSURE_FREQS[number]

const BAND_BG: Record<Band, string> = {
  extreme: '#DC2626', high: '#F97316', moderate: '#FBBF24', low: '#10B981',
}
const BAND_FG: Record<Band, string> = {
  extreme: '#fff', high: '#fff', moderate: '#0F172A', low: '#fff',
}

interface DraftControl {
  local_id:        string
  hierarchy_level: HierarchyLevel
  custom_name:     string
}

let nextCtrlId = 1

export default function NewRiskScreen() {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canCreate = !!profile?.is_admin || !!profile?.is_superadmin

  // ─── Identify ──────────────────────────────────────────────────────────
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')

  // ─── Categorize ────────────────────────────────────────────────────────
  const [hazardCategory, setHazardCategory] = useState<HazardCategory | ''>('')
  const [source,         setSource]         = useState<Source | ''>('')
  const [location,       setLocation]       = useState('')
  const [processName,    setProcessName]    = useState('')
  const [activityType,   setActivityType]   = useState<ActivityType | ''>('')
  const [exposureFreq,   setExposureFreq]   = useState<ExposureFreq | ''>('')

  // ─── Inherent score ────────────────────────────────────────────────────
  const [inhSev, setInhSev] = useState<number>(3)
  const [inhLik, setInhLik] = useState<number>(3)
  const inhScore = useMemo(() => scoreRisk(inhSev, inhLik), [inhSev, inhLik])
  const inhBand: Band = useMemo(() => bandFor(inhScore), [inhScore])

  // ─── Residual score (optional) ─────────────────────────────────────────
  const [hasResidual, setHasResidual] = useState(false)
  const [resSev, setResSev] = useState<number>(2)
  const [resLik, setResLik] = useState<number>(2)
  const resScore = useMemo(() => scoreRisk(resSev, resLik), [resSev, resLik])
  const resBand: Band = useMemo(() => bandFor(resScore), [resScore])

  // ─── Controls ──────────────────────────────────────────────────────────
  const [controls, setControls] = useState<DraftControl[]>([])
  const [ppeJustification, setPpeJustification] = useState('')

  const ppeCheck = useMemo(
    () => evaluatePpeAloneRule({
      inherentScore:           inhScore,
      controlLevels:           controls.map(c => c.hierarchy_level),
      hasPpeOnlyJustification: ppeJustification.trim().length > 0,
    }),
    [inhScore, controls, ppeJustification],
  )

  // ─── Submit state ──────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!canCreate) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Admins only.</Text>
      </View>
    )
  }

  function addControl() {
    setControls(prev => [...prev, {
      local_id: `c-${nextCtrlId++}`,
      hierarchy_level: 'engineering',
      custom_name: '',
    }])
  }
  function updateControl(lid: string, patch: Partial<DraftControl>) {
    setControls(prev => prev.map(c => c.local_id === lid ? { ...c, ...patch } : c))
  }
  function removeControl(lid: string) {
    setControls(prev => prev.filter(c => c.local_id !== lid))
  }

  async function onSubmit() {
    if (!tenant?.id) { setError('No active tenant.'); return }
    if (!title.trim())          { setError('Title is required.'); return }
    if (!description.trim())    { setError('Description is required.'); return }
    if (!hazardCategory)        { setError('Hazard category is required.'); return }
    if (!source)                { setError('Source is required.'); return }
    if (!activityType)          { setError('Activity type is required.'); return }
    if (!exposureFreq)          { setError('Exposure frequency is required.'); return }
    if (ppeCheck.applies && !ppeCheck.allowed) {
      setError('PPE-alone risks need a documented justification (ISO 45001 8.1.2).')
      return
    }
    for (const c of controls) {
      if (!c.custom_name.trim()) { setError('Every control needs a name.'); return }
    }

    setSubmitting(true); setError(null)
    try {
      const apiBase = process.env.EXPO_PUBLIC_WEB_ORIGIN
        ?? process.env.EXPO_PUBLIC_API_BASE_URL
        ?? ''
      if (!apiBase) {
        throw new Error('EXPO_PUBLIC_WEB_ORIGIN env var not set; cannot reach the create endpoint.')
      }

      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const payload = {
        risk: {
          title:               title.trim(),
          description:         description.trim(),
          hazard_category:     hazardCategory,
          source,
          location:            location.trim() || null,
          process:             processName.trim() || null,
          activity_type:       activityType,
          exposure_frequency:  exposureFreq,
          inherent_severity:   inhSev,
          inherent_likelihood: inhLik,
          ...(hasResidual ? {
            residual_severity:   resSev,
            residual_likelihood: resLik,
          } : {}),
          ...(ppeJustification.trim() ? { ppe_only_justification: ppeJustification.trim() } : {}),
        },
        controls: controls.map(c => ({
          hierarchy_level: c.hierarchy_level,
          custom_name:     c.custom_name.trim(),
          status:          'planned',
        })),
      }

      const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/risk`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      const newId: string | undefined = body?.risk?.id
      if (newId) router.replace({ pathname: '/risk/[id]', params: { id: newId } })
      else       router.replace('/(tabs)/risk')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{
        title: 'New Risk',
        headerRight: () => (
          <Pressable onPress={onSubmit} disabled={submitting}>
            {({ pressed }) => (
              <Text style={[styles.saveBtn, pressed && { opacity: 0.6 }, submitting && { opacity: 0.5 }]}>
                {submitting ? 'Saving…' : 'Submit'}
              </Text>
            )}
          </Pressable>
        ),
      }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.subtitle}>
          Identify a hazard, evaluate inherent + residual risk, and apply controls per ISO 45001 6.1.
        </Text>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        {/* Identify */}
        <Section title="Identify">
          <Field label="Title" required>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g. Forklift collision near loading dock"
              placeholderTextColor="#94a3b8"
              style={styles.input}
            />
          </Field>
          <Field label="Description" required>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="What is the hazard? What's the worst-case outcome?"
              placeholderTextColor="#94a3b8"
              multiline
              style={[styles.input, styles.multiline]}
            />
          </Field>
        </Section>

        {/* Categorize */}
        <Section title="Categorize">
          <Field label="Hazard category" required>
            <ChipPicker value={hazardCategory} options={HAZARD_CATEGORIES as readonly string[]} onChange={v => setHazardCategory(v as HazardCategory)} />
          </Field>
          <Field label="Source" required>
            <ChipPicker value={source} options={SOURCES as readonly string[]} onChange={v => setSource(v as Source)} />
          </Field>
          <Field label="Activity type" required>
            <ChipPicker value={activityType} options={ACTIVITY_TYPES as readonly string[]} onChange={v => setActivityType(v as ActivityType)} />
          </Field>
          <Field label="Exposure frequency" required>
            <ChipPicker value={exposureFreq} options={EXPOSURE_FREQS as readonly string[]} onChange={v => setExposureFreq(v as ExposureFreq)} />
          </Field>
          <Field label="Location">
            <TextInput value={location} onChangeText={setLocation} placeholder="e.g. Loading dock B" placeholderTextColor="#94a3b8" style={styles.input} />
          </Field>
          <Field label="Process">
            <TextInput value={processName} onChangeText={setProcessName} placeholder="e.g. Inbound receiving" placeholderTextColor="#94a3b8" style={styles.input} />
          </Field>
        </Section>

        {/* Inherent score */}
        <Section title="Inherent risk (no controls)">
          <ScoreSelector label="Severity"   value={inhSev} onChange={setInhSev} />
          <ScoreSelector label="Likelihood" value={inhLik} onChange={setInhLik} />
          <View style={[styles.scorePreview, { backgroundColor: BAND_BG[inhBand] }]}>
            <Text style={[styles.scorePreviewLabel, { color: BAND_FG[inhBand] }]}>Score</Text>
            <Text style={[styles.scorePreviewValue, { color: BAND_FG[inhBand] }]}>{inhScore}</Text>
            <Text style={[styles.scorePreviewBand, { color: BAND_FG[inhBand] }]}>{inhBand.toUpperCase()}</Text>
          </View>
        </Section>

        {/* Controls */}
        <Section title="Controls">
          {controls.length === 0 && (
            <Text style={styles.emptyHint}>No controls yet. Add at least one to plan how this risk gets managed.</Text>
          )}
          {controls.map(c => (
            <View key={c.local_id} style={styles.controlRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <ChipPicker
                  value={c.hierarchy_level}
                  options={HIERARCHY_ORDER as readonly string[]}
                  labelMap={HIERARCHY_LABELS as Record<string, string>}
                  onChange={v => updateControl(c.local_id, { hierarchy_level: v as HierarchyLevel })}
                />
                <TextInput
                  value={c.custom_name}
                  onChangeText={t => updateControl(c.local_id, { custom_name: t })}
                  placeholder="Control name"
                  placeholderTextColor="#94a3b8"
                  style={styles.input}
                />
              </View>
              <Pressable onPress={() => removeControl(c.local_id)}>
                {({ pressed }) => (
                  <Text style={[styles.iconBtn, styles.iconBtnDanger, pressed && { opacity: 0.6 }]}>×</Text>
                )}
              </Pressable>
            </View>
          ))}
          <Pressable onPress={addControl}>
            {({ pressed }) => (
              <View style={[styles.addBtn, pressed && { opacity: 0.6 }]}>
                <Text style={styles.addBtnText}>+ Add control</Text>
              </View>
            )}
          </Pressable>
        </Section>

        {/* PPE-alone warning */}
        {ppeCheck.applies && (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>PPE-alone (ISO 45001 8.1.2)</Text>
            <Text style={styles.warnBody}>
              Inherent score is {inhScore} and every control is PPE-level. Document why higher-level controls (elimination, substitution, engineering, administrative) aren't feasible.
            </Text>
            <TextInput
              value={ppeJustification}
              onChangeText={setPpeJustification}
              placeholder="Justification (required to submit)"
              placeholderTextColor="#94a3b8"
              multiline
              style={[styles.input, styles.multiline, { backgroundColor: '#fff' }]}
            />
          </View>
        )}

        {/* Residual score (optional) */}
        <Section title="Residual risk (optional)">
          <Pressable onPress={() => setHasResidual(b => !b)}>
            {({ pressed }) => (
              <View style={[styles.toggle, hasResidual && styles.toggleActive, pressed && { opacity: 0.6 }]}>
                <Text style={[styles.toggleText, hasResidual && styles.toggleTextActive]}>
                  {hasResidual ? '✓ Score residual now' : 'Score residual now'}
                </Text>
              </View>
            )}
          </Pressable>
          {hasResidual && (
            <>
              <ScoreSelector label="Severity"   value={resSev} onChange={setResSev} />
              <ScoreSelector label="Likelihood" value={resLik} onChange={setResLik} />
              <View style={[styles.scorePreview, { backgroundColor: BAND_BG[resBand] }]}>
                <Text style={[styles.scorePreviewLabel, { color: BAND_FG[resBand] }]}>Score</Text>
                <Text style={[styles.scorePreviewValue, { color: BAND_FG[resBand] }]}>{resScore}</Text>
                <Text style={[styles.scorePreviewBand, { color: BAND_FG[resBand] }]}>{resBand.toUpperCase()}</Text>
              </View>
            </>
          )}
        </Section>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#DC2626' }}> *</Text> : null}</Text>
      {children}
    </View>
  )
}

function ChipPicker({ value, options, onChange, labelMap }: {
  value:    string
  options:  readonly string[]
  onChange: (v: string) => void
  labelMap?: Record<string, string>
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
      {options.map(o => (
        <Pressable key={o} onPress={() => onChange(o)}>
          {({ pressed }) => (
            <View style={[styles.chip, value === o && styles.chipActive, pressed && { opacity: 0.6 }]}>
              <Text style={[styles.chipText, value === o && styles.chipTextActive]}>
                {labelMap?.[o] ?? o.replace('_', ' ')}
              </Text>
            </View>
          )}
        </Pressable>
      ))}
    </ScrollView>
  )
}

function ScoreSelector({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(n => (
          <Pressable key={n} onPress={() => onChange(n)} style={{ flex: 1 }}>
            {({ pressed }) => (
              <View style={[styles.scoreBtn, value === n && styles.scoreBtnActive, pressed && { opacity: 0.6 }]}>
                <Text style={[styles.scoreBtnText, value === n && styles.scoreBtnTextActive]}>{n}</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content:       { padding: 16, gap: 14, paddingBottom: 40 },
  subtitle:      { fontSize: 13, opacity: 0.7 },

  saveBtn:       { color: '#1e3a8a', fontSize: 15, fontWeight: '700', paddingHorizontal: 12 },

  errorBox:      { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:     { color: '#7F1D1D', fontSize: 13 },

  section:       { gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  sectionTitle:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },

  fieldLabel:    { fontSize: 12, fontWeight: '600' },
  input:         { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  multiline:     { minHeight: 70, textAlignVertical: 'top' },

  chip:          { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  chipActive:    { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  chipText:      { fontSize: 12, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  scoreBtn:      { paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center', backgroundColor: '#fff' },
  scoreBtnActive: { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  scoreBtnText:  { fontSize: 14, fontWeight: '600' },
  scoreBtnTextActive: { color: '#fff' },

  scorePreview:  { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  scorePreviewLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  scorePreviewValue: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scorePreviewBand: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },

  toggle:        { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#cbd5e1' },
  toggleActive:  { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  toggleText:    { fontSize: 12 },
  toggleTextActive: { color: '#fff', fontWeight: '600' },

  emptyHint:     { fontSize: 12, fontStyle: 'italic', opacity: 0.5 },

  controlRow:    { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  iconBtn:       { fontSize: 18, fontWeight: '700', paddingHorizontal: 10, paddingVertical: 4 },
  iconBtnDanger: { color: '#DC2626' },

  addBtn:        { padding: 10, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd5e1', alignItems: 'center' },
  addBtnText:    { fontSize: 13, fontWeight: '600', color: '#1e3a8a' },

  warnBox:       { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FEF3C7', gap: 8 },
  warnTitle:     { fontSize: 13, fontWeight: '700', color: '#78350f' },
  warnBody:      { fontSize: 12, color: '#78350f' },
})
