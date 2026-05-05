import { Link, Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  groupHazardsByStep,
  groupControlsByHazard,
  highestPotentialSeverity,
  type JhaRow,
  type JhaStep,
  type JhaHazard,
  type JhaHazardControl,
  type JhaSeverity,
  type JhaStatus,
  type JhaFrequency,
} from '@soteria/core/jha'
import { HIERARCHY_LABELS } from '@soteria/core/risk'

// /jha/[id] — Read-only detail. Mirrors the web detail page (header
// + meta grid + required PPE + steps/hazards/controls tree + audit
// timeline). Editor lands in slice 3.

const SEVERITY_BG: Record<JhaSeverity, string> = {
  extreme: '#DC2626', high: '#F97316', moderate: '#FBBF24', low: '#10B981',
}
const SEVERITY_FG: Record<JhaSeverity, string> = {
  extreme: '#fff', high: '#fff', moderate: '#0F172A', low: '#fff',
}
const STATUS_BG: Record<JhaStatus, string> = {
  draft: '#e2e8f0', in_review: '#fef3c7', approved: '#d1fae5', superseded: '#f1f5f9',
}
const STATUS_FG: Record<JhaStatus, string> = {
  draft: '#334155', in_review: '#92400e', approved: '#065f46', superseded: '#94a3b8',
}
const FREQUENCY_LABEL: Record<JhaFrequency, string> = {
  continuous: 'Continuous', daily: 'Daily', weekly: 'Weekly',
  monthly: 'Monthly', quarterly: 'Quarterly',
  annually: 'Annually', as_needed: 'As needed',
}

interface DetailBundle {
  jha:       JhaRow
  steps:     JhaStep[]
  hazards:   JhaHazard[]
  controls:  JhaHazardControl[]
}

export default function JhaDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  const [bundle, setBundle] = useState<DetailBundle | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id || !id) return
    async function load() {
      const [jhaRes, stepsRes, hazardsRes, controlsRes] = await Promise.all([
        supabase.from('jhas').select('*').eq('id', id).eq('tenant_id', tenant!.id).maybeSingle(),
        supabase.from('jha_steps').select('*').eq('jha_id', id).eq('tenant_id', tenant!.id).order('sequence', { ascending: true }),
        supabase.from('jha_hazards').select('*').eq('jha_id', id).eq('tenant_id', tenant!.id),
        supabase.from('jha_hazard_controls').select('*').eq('jha_id', id).eq('tenant_id', tenant!.id),
      ])
      if (cancelled) return
      const err = jhaRes.error || stepsRes.error || hazardsRes.error || controlsRes.error
      if (err) { setError(err.message); return }
      if (!jhaRes.data) { setError('Not found'); return }
      setBundle({
        jha:      jhaRes.data as JhaRow,
        steps:    (stepsRes.data ?? []) as JhaStep[],
        hazards:  (hazardsRes.data ?? []) as JhaHazard[],
        controls: (controlsRes.data ?? []) as JhaHazardControl[],
      })
    }
    void load()
    return () => { cancelled = true }
  }, [tenant?.id, id])

  if (!bundle && !error) {
    return <View style={styles.center}><ActivityIndicator /></View>
  }
  if (error || !bundle) {
    return <View style={styles.center}><Text style={styles.errorText}>{error ?? 'Not found.'}</Text></View>
  }

  const { jha, steps, hazards, controls } = bundle
  const grouped = groupHazardsByStep(steps, hazards)
  const controlsByHazard = groupControlsByHazard(hazards, controls)
  const worst = highestPotentialSeverity(hazards)

  return (
    <>
      <Stack.Screen options={{ title: jha.job_number }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.jobNumber}>{jha.job_number}</Text>
            <Text style={styles.title}>{jha.title}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: STATUS_BG[jha.status] }]}>
            <Text style={[styles.statusText, { color: STATUS_FG[jha.status] }]}>{jha.status.replace('_', ' ')}</Text>
          </View>
        </View>

        {canEdit && jha.status !== 'superseded' && (
          <Link href={{ pathname: '/jha/[id]/edit', params: { id: jha.id } }} asChild>
            <Pressable>
              {({ pressed }) => (
                <View style={[styles.editBtn, pressed && { opacity: 0.7 }]}>
                  <Text style={styles.editBtnText}>Edit breakdown</Text>
                </View>
              )}
            </Pressable>
          </Link>
        )}

        <View style={styles.metaGrid}>
          <Meta label="Frequency"     value={FREQUENCY_LABEL[jha.frequency]} />
          <Meta label="Location"      value={jha.location ?? '—'} />
          <Meta label="Performed by"  value={jha.performed_by ?? '—'} />
          <Meta label="Steps"         value={String(steps.length)} />
          <Meta label="Hazards"       value={String(hazards.length)} />
          <Meta label="Worst case"    value={worst ?? '—'} capitalize />
          <Meta label="Next review"   value={jha.next_review_date ?? '—'} />
          <Meta label="Approved"      value={jha.approved_at ? fmt(jha.approved_at) : '—'} />
        </View>

        {jha.description && (
          <Section title="Description"><Text style={styles.body}>{jha.description}</Text></Section>
        )}

        {jha.required_ppe.length > 0 && (
          <Section title="Required PPE">
            <View style={styles.ppeRow}>
              {jha.required_ppe.map(p => (
                <View key={p} style={styles.ppeChip}>
                  <Text style={styles.ppeChipText}>{p}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        <Section title={`Steps & hazards (${steps.length} ${steps.length === 1 ? 'step' : 'steps'})`}>
          {steps.length === 0 && hazards.length === 0 ? (
            <Text style={styles.emptyHint}>
              No steps or hazards yet. The mobile editor lands in slice 3.
            </Text>
          ) : (
            <View style={{ gap: 10 }}>
              {grouped.map((g, i) => (
                <View key={g.step?.id ?? `general-${i}`} style={styles.stepCard}>
                  <View style={styles.stepHeader}>
                    {g.step ? (
                      <>
                        <Text style={styles.stepSeq}>{g.step.sequence}.</Text>
                        <Text style={styles.stepTitle}>{g.step.description}</Text>
                      </>
                    ) : (
                      <Text style={styles.generalLabel}>General hazards</Text>
                    )}
                  </View>
                  {g.step?.notes && <Text style={styles.stepNotes}>{g.step.notes}</Text>}
                  {g.hazards.length === 0 ? (
                    <Text style={styles.emptyHint}>No hazards identified.</Text>
                  ) : (
                    g.hazards.map(h => (
                      <View key={h.id} style={styles.hazardCard}>
                        <View style={styles.hazardHeader}>
                          <View style={[styles.sevPill, { backgroundColor: SEVERITY_BG[h.potential_severity] }]}>
                            <Text style={[styles.sevText, { color: SEVERITY_FG[h.potential_severity] }]}>
                              {h.potential_severity}
                            </Text>
                          </View>
                          <Text style={styles.hazardCategory}>{h.hazard_category}</Text>
                        </View>
                        <Text style={styles.hazardDesc}>{h.description}</Text>
                        {h.notes && <Text style={styles.hazardNotes}>{h.notes}</Text>}
                        <ControlList controls={controlsByHazard.get(h.id) ?? []} />
                      </View>
                    ))
                  )}
                </View>
              ))}
            </View>
          )}
        </Section>
      </ScrollView>
    </>
  )
}

function ControlList({ controls }: { controls: JhaHazardControl[] }) {
  if (controls.length === 0) {
    return <Text style={styles.noControls}>No controls — needs attention.</Text>
  }
  return (
    <View style={{ gap: 4, marginTop: 6 }}>
      {controls.map(c => (
        <View key={c.id} style={styles.controlRow}>
          <Text style={styles.controlLevel}>{HIERARCHY_LABELS[c.hierarchy_level]}</Text>
          <Text style={styles.controlName}>{c.custom_name ?? c.control_id ?? '—'}</Text>
        </View>
      ))}
    </View>
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

function Meta({ label, value, capitalize }: { label: string; value: string; capitalize?: boolean }) {
  return (
    <View style={styles.metaCell}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={[styles.metaValue, capitalize && { textTransform: 'capitalize' }]}>{value}</Text>
    </View>
  )
}

function fmt(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric' })
}

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content:       { padding: 16, gap: 14, paddingBottom: 40 },

  headerRow:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  jobNumber:     { fontFamily: 'SpaceMono', fontSize: 12, opacity: 0.6 },
  title:         { fontSize: 18, fontWeight: '700', marginTop: 2 },

  statusPill:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  editBtn:       { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1' },
  editBtnText:   { fontSize: 13, fontWeight: '600' },

  metaGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
  metaCell:      { width: '46%' },
  metaLabel:     { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  metaValue:     { fontSize: 13, marginTop: 2 },

  section:       { gap: 6, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },
  sectionTitle:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  body:          { fontSize: 14, lineHeight: 20 },
  emptyHint:     { fontSize: 12, fontStyle: 'italic', opacity: 0.5 },

  ppeRow:        { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ppeChip:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: '#fef3c7' },
  ppeChipText:   { fontSize: 12, color: '#78350f', fontWeight: '600' },

  stepCard:      { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', gap: 6 },
  stepHeader:    { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  stepSeq:       { fontFamily: 'SpaceMono', fontSize: 12, opacity: 0.6 },
  stepTitle:     { fontSize: 14, fontWeight: '600', flex: 1 },
  stepNotes:     { fontSize: 11, opacity: 0.6 },
  generalLabel:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },

  hazardCard:    { padding: 8, borderRadius: 8, backgroundColor: 'rgba(148, 163, 184, 0.08)', gap: 4 },
  hazardHeader:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sevPill:       { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  sevText:       { fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  hazardCategory: { fontSize: 10, opacity: 0.6, textTransform: 'capitalize' },
  hazardDesc:    { fontSize: 13 },
  hazardNotes:   { fontSize: 11, opacity: 0.6 },

  noControls:    { fontSize: 11, fontStyle: 'italic', color: '#7F1D1D', marginTop: 4 },
  controlRow:    { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  controlLevel:  { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5, width: 80 },
  controlName:   { flex: 1, fontSize: 12 },

  errorText:     { color: '#7F1D1D', fontSize: 13 },
})
