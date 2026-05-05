import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HIERARCHY_LABELS,
  type Band,
  type HierarchyLevel,
} from '@soteria/core/risk'
import type { RiskDetail, RiskControl, RiskReviewRow, RiskStatus } from '@soteria/core/queries/risks'

// /risk/[id] — Read-only detail. Shows the score card, controls
// table, review history, and last-N audit-log entries. Quick
// actions (status change, mark-reviewed) live on the web for now.

const BAND_BG: Record<Band, string> = {
  extreme: '#DC2626', high: '#F97316', moderate: '#FBBF24', low: '#10B981',
}
const BAND_FG: Record<Band, string> = {
  extreme: '#fff', high: '#fff', moderate: '#0F172A', low: '#fff',
}
const STATUS_BG: Record<RiskStatus, string> = {
  open: '#dbeafe', in_review: '#fef3c7', controls_in_progress: '#e0e7ff',
  monitoring: '#cffafe', closed: '#d1fae5', accepted_exception: '#fee2e2',
}
const STATUS_FG: Record<RiskStatus, string> = {
  open: '#1e3a8a', in_review: '#92400e', controls_in_progress: '#3730a3',
  monitoring: '#155e75', closed: '#065f46', accepted_exception: '#991b1b',
}
const STATUS_LABEL: Record<RiskStatus, string> = {
  open: 'Open', in_review: 'In review', controls_in_progress: 'Controls',
  monitoring: 'Monitoring', closed: 'Closed', accepted_exception: 'Accepted',
}

interface DetailBundle {
  risk:     RiskDetail
  controls: RiskControl[]
  reviews:  RiskReviewRow[]
}

export default function RiskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { tenant } = useTenant()
  const [bundle, setBundle] = useState<DetailBundle | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id || !id) return
    async function load() {
      const [riskRes, ctrlRes, revRes] = await Promise.all([
        supabase.from('risks').select('*').eq('id', id).eq('tenant_id', tenant!.id).maybeSingle(),
        supabase.from('risk_controls').select('id, hierarchy_level, control_id, custom_name, status, notes, implemented_at, verified_at, created_at, controls_library(name)').eq('risk_id', id).eq('tenant_id', tenant!.id),
        supabase.from('risk_reviews').select('id, reviewed_at, reviewed_by, trigger, inherent_score_at_review, residual_score_at_review, outcome, notes').eq('risk_id', id).eq('tenant_id', tenant!.id).order('reviewed_at', { ascending: false }),
      ])
      if (cancelled) return
      const err = riskRes.error || ctrlRes.error || revRes.error
      if (err) { setError(err.message); return }
      if (!riskRes.data) { setError('Not found'); return }

      type CtrlRow = Omit<RiskControl, 'library_name'> & { controls_library?: { name?: string } | null }
      const controls = ((ctrlRes.data ?? []) as unknown as CtrlRow[]).map(c => ({
        id:              c.id,
        hierarchy_level: c.hierarchy_level as HierarchyLevel,
        control_id:      c.control_id,
        custom_name:     c.custom_name,
        library_name:    c.controls_library?.name ?? null,
        status:          c.status,
        notes:           c.notes,
        implemented_at:  c.implemented_at,
        verified_at:     c.verified_at,
        created_at:      c.created_at,
      })) as RiskControl[]

      setBundle({
        risk:     riskRes.data as RiskDetail,
        controls,
        reviews:  (revRes.data ?? []) as RiskReviewRow[],
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

  const { risk, controls, reviews } = bundle
  const inhBand: Band = risk.inherent_band
  const resBand: Band | null = risk.residual_band

  return (
    <>
      <Stack.Screen options={{ title: risk.risk_number }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.riskNumber}>{risk.risk_number}</Text>
            <Text style={styles.title}>{risk.title}</Text>
          </View>
          <View style={[styles.statusPill, { backgroundColor: STATUS_BG[risk.status] }]}>
            <Text style={[styles.statusText, { color: STATUS_FG[risk.status] }]}>{STATUS_LABEL[risk.status]}</Text>
          </View>
        </View>

        {/* Score card — inherent + residual side-by-side */}
        <View style={styles.scoreCardRow}>
          <ScoreTile label="Inherent" severity={risk.inherent_severity} likelihood={risk.inherent_likelihood} score={risk.inherent_score} band={inhBand} />
          {risk.residual_score != null && resBand ? (
            <ScoreTile label="Residual" severity={risk.residual_severity!} likelihood={risk.residual_likelihood!} score={risk.residual_score} band={resBand} />
          ) : (
            <View style={[styles.scoreTile, styles.scoreTileEmpty]}>
              <Text style={styles.scoreLabel}>Residual</Text>
              <Text style={styles.scoreEmpty}>not yet scored</Text>
            </View>
          )}
        </View>

        <View style={styles.metaGrid}>
          <Meta label="Hazard"   value={risk.hazard_category} capitalize />
          <Meta label="Source"   value={risk.source} capitalize />
          <Meta label="Activity" value={risk.activity_type.replace('_', ' ')} capitalize />
          <Meta label="Exposure" value={risk.exposure_frequency} capitalize />
          <Meta label="Location" value={risk.location ?? '—'} />
          <Meta label="Process"  value={risk.process ?? '—'} />
          <Meta label="Next review" value={risk.next_review_date ?? '—'} />
          <Meta label="Last reviewed" value={risk.last_reviewed_at ? fmt(risk.last_reviewed_at) : '—'} />
        </View>

        <Section title="Description">
          <Text style={styles.body}>{risk.description}</Text>
        </Section>

        {risk.ppe_only_justification && (
          <Section title="PPE-alone justification (ISO 45001 8.1.2)">
            <Text style={styles.body}>{risk.ppe_only_justification}</Text>
          </Section>
        )}

        <Section title={`Controls (${controls.length})`}>
          {controls.length === 0 ? (
            <Text style={styles.emptyHint}>No controls applied yet.</Text>
          ) : (
            controls
              .slice()
              .sort((a, b) => HIERARCHY_LEVELS_ORDER[a.hierarchy_level] - HIERARCHY_LEVELS_ORDER[b.hierarchy_level])
              .map(c => (
                <View key={c.id} style={styles.controlRow}>
                  <Text style={styles.controlLevel}>{HIERARCHY_LABELS[c.hierarchy_level]}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.controlName}>{c.custom_name ?? c.library_name ?? '—'}</Text>
                    <Text style={styles.controlMeta}>
                      {c.status}
                      {c.implemented_at ? ` · implemented ${fmt(c.implemented_at)}` : ''}
                      {c.verified_at ? ` · verified ${fmt(c.verified_at)}` : ''}
                    </Text>
                  </View>
                </View>
              ))
          )}
        </Section>

        <Section title={`Reviews (${reviews.length})`}>
          {reviews.length === 0 ? (
            <Text style={styles.emptyHint}>No reviews recorded yet.</Text>
          ) : (
            reviews.map(r => (
              <View key={r.id} style={styles.reviewRow}>
                <Text style={styles.reviewDate}>{fmt(r.reviewed_at)}</Text>
                <Text style={styles.reviewMeta}>
                  {r.trigger} · {r.outcome.replace('_', ' ')}
                </Text>
                {r.notes && <Text style={styles.reviewNotes}>{r.notes}</Text>}
              </View>
            ))
          )}
        </Section>

        <Text style={styles.footer}>
          Quick actions (status change, mark reviewed, escalate) live on the web for now.
        </Text>
      </ScrollView>
    </>
  )
}

const HIERARCHY_LEVELS_ORDER: Record<HierarchyLevel, number> = {
  elimination: 0, substitution: 1, engineering: 2, administrative: 3, ppe: 4,
}

function ScoreTile({ label, severity, likelihood, score, band }: {
  label: string; severity: number; likelihood: number; score: number; band: Band
}) {
  return (
    <View style={[styles.scoreTile, { borderColor: BAND_BG[band] }]}>
      <Text style={styles.scoreLabel}>{label}</Text>
      <View style={[styles.scoreBand, { backgroundColor: BAND_BG[band] }]}>
        <Text style={[styles.scoreValue, { color: BAND_FG[band] }]}>{score}</Text>
      </View>
      <Text style={styles.scoreFormula}>{severity} × {likelihood}</Text>
      <Text style={[styles.scoreBandLabel, { color: BAND_BG[band] }]}>{band.toUpperCase()}</Text>
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
  riskNumber:    { fontFamily: 'SpaceMono', fontSize: 12, opacity: 0.6 },
  title:         { fontSize: 18, fontWeight: '700', marginTop: 2 },
  statusPill:    { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  statusText:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  scoreCardRow:  { flexDirection: 'row', gap: 10 },
  scoreTile:     { flex: 1, padding: 12, borderRadius: 12, borderWidth: 2, alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.5)' },
  scoreTileEmpty: { borderColor: '#cbd5e1', borderStyle: 'dashed', justifyContent: 'center' },
  scoreLabel:    { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.6 },
  scoreBand:     { paddingHorizontal: 16, paddingVertical: 4, borderRadius: 8, marginVertical: 4 },
  scoreValue:    { fontSize: 28, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreFormula:  { fontSize: 11, opacity: 0.6 },
  scoreBandLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  scoreEmpty:    { fontSize: 12, fontStyle: 'italic', opacity: 0.5 },

  metaGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
  metaCell:      { width: '46%' },
  metaLabel:     { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  metaValue:     { fontSize: 13, marginTop: 2 },

  section:       { gap: 6, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },
  sectionTitle:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  body:          { fontSize: 14, lineHeight: 20 },
  emptyHint:     { fontSize: 12, fontStyle: 'italic', opacity: 0.5 },

  controlRow:    { flexDirection: 'row', gap: 8, paddingVertical: 6, alignItems: 'flex-start' },
  controlLevel:  { fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5, width: 90 },
  controlName:   { fontSize: 13, fontWeight: '500' },
  controlMeta:   { fontSize: 11, opacity: 0.6, marginTop: 2 },

  reviewRow:     { paddingVertical: 6, gap: 2 },
  reviewDate:    { fontSize: 12, fontWeight: '600' },
  reviewMeta:    { fontSize: 11, opacity: 0.6 },
  reviewNotes:   { fontSize: 12, marginTop: 2 },

  errorText:     { color: '#7F1D1D', fontSize: 13 },
  footer:        { fontSize: 11, fontStyle: 'italic', opacity: 0.5, textAlign: 'center', marginTop: 16 },
})
