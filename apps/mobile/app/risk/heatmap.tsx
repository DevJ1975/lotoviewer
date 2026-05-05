import { Stack, router } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { bandFor, scoreRisk, type Band } from '@soteria/core/risk'
import type { RiskSummary, RiskStatus } from '@soteria/core/queries/risks'
import { SEVERITY_HEX, SEVERITY_FG_HEX } from '@soteria/core/severityColors'

// /risk/heatmap — 5×5 ISO 45001 risk matrix. iPad target so the
// full grid fits on one screen at a glance; on phones it scales
// down but stays usable. Tap a cell to drill down to the risks
// at that score; tap a risk to open its detail page.
//
// Toggle between "inherent" and "residual" view. Default is
// residual (post-control), matching the web heat map page.

const STATUS_LABEL: Record<RiskStatus, string> = {
  open: 'Open', in_review: 'In review', controls_in_progress: 'Controls',
  monitoring: 'Monitoring', closed: 'Closed', accepted_exception: 'Accepted',
}

interface CellSelection {
  severity:   number
  likelihood: number
  risks:      RiskSummary[]
}

export default function RiskHeatmapScreen() {
  const { tenant } = useTenant()
  const [view, setView] = useState<'residual' | 'inherent'>('residual')
  const [risks, setRisks] = useState<RiskSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<CellSelection | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id) return
    async function load() {
      setError(null)
      const { data, error } = await supabase
        .from('risks')
        .select('id, risk_number, title, hazard_category, status, inherent_severity, inherent_likelihood, inherent_score, inherent_band, residual_severity, residual_likelihood, residual_score, residual_band, assigned_to, next_review_date, created_at, updated_at')
        .eq('tenant_id', tenant!.id)
        .not('status', 'in', '(closed,accepted_exception)')
        .limit(500)
      if (cancelled) return
      if (error) { setError(error.message); return }
      setRisks((data ?? []) as RiskSummary[])
    }
    void load()
    return () => { cancelled = true }
  }, [tenant?.id])

  // Group risks into the 5×5 grid using either inherent or residual
  // axes per the toggle. NULL residual rows (not yet re-scored) drop
  // out of the residual view by design.
  const cellMap = useMemo(() => {
    const m = new Map<string, RiskSummary[]>()
    if (!risks) return m
    for (const r of risks) {
      const sev = view === 'residual' ? r.residual_severity : r.inherent_severity
      const lik = view === 'residual' ? r.residual_likelihood : r.inherent_likelihood
      if (sev == null || lik == null) continue
      const key = `${sev},${lik}`
      const list = m.get(key) ?? []
      list.push(r)
      m.set(key, list)
    }
    return m
  }, [risks, view])

  const totalCounted = useMemo(
    () => Array.from(cellMap.values()).reduce((n, list) => n + list.length, 0),
    [cellMap],
  )

  if (!risks && !error) {
    return <View style={styles.center}><ActivityIndicator /></View>
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Heat map' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.toggleRow}>
          {(['residual', 'inherent'] as const).map(v => (
            <Pressable key={v} onPress={() => setView(v)}>
              {({ pressed }) => (
                <View style={[styles.toggle, view === v && styles.toggleActive, pressed && { opacity: 0.6 }]}>
                  <Text style={[styles.toggleText, view === v && styles.toggleTextActive]}>{v}</Text>
                </View>
              )}
            </Pressable>
          ))}
          <View style={{ flex: 1 }} />
          <Text style={styles.totalCount}>{totalCounted} risks</Text>
        </View>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        {/* Grid: x-axis = severity 1..5, y-axis = likelihood 5..1
            (top = Almost Certain). Top-left axis label cell is empty. */}
        <View style={styles.grid}>
          {/* Top header row: severity labels */}
          <View style={styles.gridRow}>
            <View style={styles.axisCellCorner} />
            {[1, 2, 3, 4, 5].map(s => (
              <View key={s} style={styles.axisCellTop}>
                <Text style={styles.axisLabel}>S{s}</Text>
              </View>
            ))}
          </View>
          {[5, 4, 3, 2, 1].map(lik => (
            <View key={lik} style={styles.gridRow}>
              <View style={styles.axisCellLeft}>
                <Text style={styles.axisLabel}>L{lik}</Text>
              </View>
              {[1, 2, 3, 4, 5].map(sev => {
                const cellRisks = cellMap.get(`${sev},${lik}`) ?? []
                const score = scoreRisk(sev, lik)
                const band = bandFor(score)
                return (
                  <Pressable
                    key={`${sev},${lik}`}
                    onPress={() => cellRisks.length > 0 && setSelected({ severity: sev, likelihood: lik, risks: cellRisks })}
                  >
                    {({ pressed }) => (
                      <View style={[
                        styles.cell,
                        { backgroundColor: SEVERITY_HEX[band] },
                        pressed && cellRisks.length > 0 && { opacity: 0.7 },
                      ]}>
                        <Text style={[styles.cellScore, { color: SEVERITY_FG_HEX[band] }]}>{score}</Text>
                        {cellRisks.length > 0 && (
                          <Text style={[styles.cellCount, { color: SEVERITY_FG_HEX[band] }]}>
                            {cellRisks.length}
                          </Text>
                        )}
                      </View>
                    )}
                  </Pressable>
                )
              })}
            </View>
          ))}
        </View>

        <View style={styles.legend}>
          {(['low', 'moderate', 'high', 'extreme'] as const).map(b => (
            <View key={b} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: SEVERITY_HEX[b] }]} />
              <Text style={styles.legendText}>{b}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.note}>
          Severity × Likelihood = Score. {view === 'residual' ? 'Risks without a residual score are excluded from this view.' : 'All active risks shown.'}
        </Text>
      </ScrollView>

      {/* Drill-down modal: tap a cell → list its risks → tap a risk → detail */}
      <Modal
        visible={selected !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setSelected(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              S{selected?.severity} × L{selected?.likelihood} = {selected ? scoreRisk(selected.severity, selected.likelihood) : ''}
            </Text>
            <Text style={styles.modalSubtitle}>{selected?.risks.length} risks</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              {selected?.risks.map(r => (
                <Pressable
                  key={r.id}
                  onPress={() => {
                    setSelected(null)
                    router.push({ pathname: '/risk/[id]', params: { id: r.id } })
                  }}
                >
                  {({ pressed }) => (
                    <View style={[styles.modalRow, pressed && { opacity: 0.6 }]}>
                      <Text style={styles.modalRiskNumber}>{r.risk_number}</Text>
                      <Text style={styles.modalRiskTitle} numberOfLines={2}>{r.title}</Text>
                      <Text style={styles.modalRiskMeta}>
                        {STATUS_LABEL[r.status]} · {r.hazard_category}
                      </Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  )
}

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content:       { padding: 16, gap: 12 },

  toggleRow:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toggle:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: '#cbd5e1' },
  toggleActive:  { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  toggleText:    { fontSize: 12, textTransform: 'capitalize' },
  toggleTextActive: { color: '#fff', fontWeight: '600' },
  totalCount:    { fontSize: 12, opacity: 0.6 },

  errorBox:      { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:     { color: '#7F1D1D', fontSize: 12 },

  grid:          { gap: 2 },
  gridRow:       { flexDirection: 'row', gap: 2 },
  axisCellCorner: { flex: 0.5 },
  axisCellTop:   { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4 },
  axisCellLeft:  { flex: 0.5, alignItems: 'center', justifyContent: 'center' },
  axisLabel:     { fontSize: 11, fontWeight: '700', opacity: 0.6 },
  cell:          { flex: 1, aspectRatio: 1.6, alignItems: 'center', justifyContent: 'center', borderRadius: 6, padding: 4 },
  cellScore:     { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  cellCount:     { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },

  legend:        { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
  legendItem:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch:  { width: 14, height: 14, borderRadius: 3 },
  legendText:    { fontSize: 11, textTransform: 'capitalize', opacity: 0.7 },

  note:          { fontSize: 11, fontStyle: 'italic', opacity: 0.5, textAlign: 'center' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard:     { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 6 },
  modalTitle:    { fontSize: 16, fontWeight: '700' },
  modalSubtitle: { fontSize: 12, opacity: 0.6, marginBottom: 8 },
  modalRow:      { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1', gap: 2 },
  modalRiskNumber: { fontFamily: 'SpaceMono', fontSize: 11, opacity: 0.6, color: '#0f172a' },
  modalRiskTitle:  { fontSize: 14, fontWeight: '500', color: '#0f172a' },
  modalRiskMeta:   { fontSize: 11, opacity: 0.6, color: '#0f172a' },
})
