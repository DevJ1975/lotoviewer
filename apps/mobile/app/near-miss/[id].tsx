import { Stack, useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  ageInDays,
  type NearMissRow,
  type NearMissSeverity,
  type NearMissStatus,
} from '@soteria/core/nearMiss'
import { SEVERITY_HEX, SEVERITY_FG_HEX } from '@soteria/core/severityColors'

// /near-miss/[id] — Read-only detail. Mobile defers triage actions
// (status change, escalate) to the web app for now; field workers
// who land here are reviewing what they or a teammate filed.

const STATUS_LABEL: Record<NearMissStatus, string> = {
  new: 'New', triaged: 'Triaged', investigating: 'Investigating',
  closed: 'Closed', escalated_to_risk: 'Escalated',
}

export default function NearMissDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { tenant } = useTenant()
  const [report, setReport] = useState<NearMissRow | null>(null)
  const [error,  setError]  = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id || !id) return
    async function load() {
      const { data, error } = await supabase
        .from('near_misses')
        .select('*')
        .eq('id', id)
        .eq('tenant_id', tenant!.id)
        .maybeSingle()
      if (cancelled) return
      if (error) { setError(error.message); return }
      setReport(data as NearMissRow | null)
    }
    void load()
    return () => { cancelled = true }
  }, [tenant?.id, id])

  if (!report && !error) {
    return <View style={styles.center}><ActivityIndicator /></View>
  }
  if (error || !report) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{error ?? 'Not found.'}</Text>
      </View>
    )
  }

  return (
    <>
      <Stack.Screen options={{ title: report.report_number }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.reportNumber}>{report.report_number}</Text>
          <View style={[styles.sevPill, { backgroundColor: SEVERITY_HEX[report.severity_potential] }]}>
            <Text style={[styles.sevText, { color: SEVERITY_FG_HEX[report.severity_potential] }]}>
              {report.severity_potential}
            </Text>
          </View>
        </View>

        <Text style={styles.statusPill}>{STATUS_LABEL[report.status]}</Text>

        <View style={styles.metaGrid}>
          <Meta label="Occurred"  value={fmt(report.occurred_at)} />
          <Meta label="Reported"  value={fmt(report.reported_at)} />
          <Meta label="Age"       value={`${ageInDays(report)} d`} />
          <Meta label="Hazard"    value={report.hazard_category} capitalize />
          <Meta label="Location"  value={report.location ?? '—'} />
          {report.linked_risk_id && <Meta label="Linked risk" value={report.linked_risk_id.slice(0, 8) + '…'} />}
        </View>

        <Section title="What happened">
          <Text style={styles.body}>{report.description}</Text>
        </Section>

        {report.immediate_action_taken && (
          <Section title="Immediate action taken">
            <Text style={styles.body}>{report.immediate_action_taken}</Text>
          </Section>
        )}

        {report.resolution_notes && (
          <Section title="Resolution notes">
            <Text style={styles.body}>{report.resolution_notes}</Text>
          </Section>
        )}

        <Text style={styles.footer}>
          Triage actions (status change, escalation) live on the web for now.
        </Text>
      </ScrollView>
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
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content:       { padding: 16, gap: 14, paddingBottom: 40 },
  headerRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportNumber:  { fontFamily: 'SpaceMono', fontSize: 15, opacity: 0.6 },
  sevPill:       { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  sevText:       { fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  statusPill:    { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: '#e2e8f0', fontSize: 11, fontWeight: '600' },

  metaGrid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingVertical: 8 },
  metaCell:      { width: '46%' },
  metaLabel:     { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  metaValue:     { fontSize: 13, marginTop: 2 },

  section:       { gap: 6, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },
  sectionTitle:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  body:          { fontSize: 14, lineHeight: 20 },

  errorText:     { color: '#7F1D1D', fontSize: 13 },
  footer:        { fontSize: 11, fontStyle: 'italic', opacity: 0.5, textAlign: 'center', marginTop: 16 },
})
