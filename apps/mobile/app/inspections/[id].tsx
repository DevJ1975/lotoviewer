import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native'

import { Centered, ErrorBanner, PrimaryButton, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import {
  clearDrafts,
  isAnswerable,
  loadDrafts,
  loadInspection,
  saveDrafts,
  submitBlockers,
  submitInspection,
  type DraftMap,
  type InspectionDetail,
  type InspectionItem,
  type ItemDraft,
} from '@/lib/inspections'
import type { ResponseResult } from '@soteria/core/inspectionScoring'

export default function InspectionRunScreen() {
  return (
    <ModuleGate featureId="inspections" name="Inspections">
      <InspectionRun />
    </ModuleGate>
  )
}

const RESULT_LABEL: Record<ResponseResult, string> = { pass: 'Pass', fail: 'Fail', na: 'N/A' }
const RESULT_COLOR: Record<ResponseResult, string> = { pass: '#047857', fail: '#b91c1c', na: '#475569' }

function InspectionRun() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { tenant } = useTenant()
  const [detail, setDetail] = useState<InspectionDetail | null>(null)
  const [drafts, setDrafts] = useState<DraftMap>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    setLoading(true); setError(null)
    try {
      const [loaded, saved] = await Promise.all([loadInspection(tenant.id, id), loadDrafts(tenant.id, id)])
      setDetail(loaded)
      setDrafts(saved)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the inspection.')
    } finally {
      setLoading(false)
    }
  }, [tenant?.id, id])

  useEffect(() => { void load() }, [load])

  function updateDraft(itemId: string, patch: ItemDraft) {
    if (!tenant?.id || !id) return
    const next = { ...drafts, [itemId]: { ...drafts[itemId], ...patch } }
    setDrafts(next)
    void saveDrafts(tenant.id, id, next).catch(() => undefined)
  }

  const items = detail?.items
  const blockers = useMemo(() => (items ? submitBlockers(items, drafts) : []), [items, drafts])

  async function onSubmit() {
    if (!tenant?.id || !id || !detail) return
    setBusy(true); setError(null)
    try {
      await submitInspection(tenant.id, id, detail.items, drafts)
      await clearDrafts(tenant.id, id)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the inspection.')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !detail) return <Centered><ActivityIndicator /></Centered>
  if (!detail) return <Centered><Text style={formStyles.empty}>{error ?? 'Not found.'}</Text></Centered>

  const { inspection } = detail
  const submitted = inspection.status === 'submitted'
  const pct = inspection.max_score && inspection.max_score > 0
    ? Math.round(((inspection.score ?? 0) / inspection.max_score) * 100)
    : 100

  return (
    <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
      <Text style={{ fontSize: 18, fontWeight: '700' }}>{inspection.title}</Text>
      <ErrorBanner message={error} />

      {submitted ? (
        <View style={[styles.banner, inspection.result === 'fail' ? styles.bannerFail : styles.bannerPass]}>
          <Text style={styles.bannerText}>
            {inspection.result === 'fail' ? 'Failed' : 'Passed'} · {pct}% ({inspection.score ?? 0}/{inspection.max_score ?? 0})
          </Text>
        </View>
      ) : null}

      {detail.items.map(item => (
        <ItemCard key={item.id} item={item} draft={drafts[item.id]} readOnly={submitted} onChange={patch => updateDraft(item.id, patch)} />
      ))}

      {!submitted ? (
        <>
          {blockers.map(b => <Text key={b} style={styles.blocker}>{b}</Text>)}
          <PrimaryButton label="Submit inspection" onPress={onSubmit} busy={busy} disabled={blockers.length > 0} />
        </>
      ) : null}
    </ScrollView>
  )
}

function ItemCard({ item, draft, readOnly, onChange }: {
  item: InspectionItem
  draft: ItemDraft | undefined
  readOnly: boolean
  onChange: (patch: ItemDraft) => void
}) {
  return (
    <View style={formStyles.card}>
      {item.section ? <Text style={formStyles.rowMeta}>{item.section}</Text> : null}
      <Text style={formStyles.rowTitle}>
        {item.prompt}
        {item.required ? <Text style={{ color: '#DC2626' }}> *</Text> : null}
      </Text>

      {!isAnswerable(item.item_type) ? (
        <Text style={formStyles.rowMeta}>This {item.item_type} item is completed in the web app.</Text>
      ) : item.item_type === 'numeric' ? (
        <TextInput
          value={draft?.value ?? ''}
          onChangeText={value => onChange({ value })}
          editable={!readOnly}
          keyboardType="numeric"
          placeholder="Reading"
          placeholderTextColor="#94a3b8"
          style={formStyles.input}
        />
      ) : item.item_type === 'text' ? (
        <TextInput
          value={draft?.value ?? ''}
          onChangeText={value => onChange({ value })}
          editable={!readOnly}
          multiline
          style={[formStyles.input, formStyles.multiline]}
        />
      ) : (
        <View style={styles.resultRow}>
          {(['pass', 'fail', 'na'] as const).map(result => {
            const active = draft?.result === result
            return (
              <Pressable key={result} onPress={() => onChange({ result })} disabled={readOnly} accessibilityRole="button" accessibilityState={{ selected: active }} style={{ flex: 1 }}>
                <View style={[styles.resultBtn, active && { backgroundColor: RESULT_COLOR[result], borderColor: RESULT_COLOR[result] }]}>
                  <Text style={[styles.resultText, active && { color: '#fff' }]}>{RESULT_LABEL[result]}</Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      )}

      {isAnswerable(item.item_type) && item.item_type !== 'text' ? (
        <TextInput
          value={draft?.note ?? ''}
          onChangeText={note => onChange({ note })}
          editable={!readOnly}
          placeholder="Note (optional)"
          placeholderTextColor="#94a3b8"
          style={[formStyles.input, { fontSize: 13 }]}
        />
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  banner: { padding: 12, borderRadius: 10 },
  bannerPass: { backgroundColor: '#D1FAE5' },
  bannerFail: { backgroundColor: '#FEE2E2' },
  bannerText: { fontWeight: '700', fontSize: 14, color: '#0f172a' },
  blocker: { color: '#92400E', fontSize: 13 },
  resultRow: { flexDirection: 'row', gap: 8 },
  resultBtn: { paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'center' },
  resultText: { fontSize: 14, fontWeight: '600' },
})
