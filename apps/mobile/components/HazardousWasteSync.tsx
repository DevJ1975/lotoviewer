import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import { ErrorBanner, PrimaryButton, formStyles } from '@/components/form'
import { Text, View } from '@/components/Themed'
import { apiBase, authHeaders } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import {
  findingsFromDraft,
  HAZARDOUS_WASTE_AREA_LABEL,
  type HazardousWasteFieldDraft,
} from '@soteria/core/hazardousWaste'

// Uploads the on-device field draft as a submitted inspection. The server
// validates every finding against the chosen area's type, so the picker lists
// only areas that match the draft's area type; an area of another type would
// be rejected.

interface AreaOption {
  id:   string
  name: string
}

export default function HazardousWasteSync({ tenantId, draft, onSubmitted }: {
  tenantId: string
  draft: HazardousWasteFieldDraft
  onSubmitted: () => void
}) {
  const [areas, setAreas] = useState<AreaOption[] | null>(null)
  const [areaId, setAreaId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const loadAreas = useCallback(async () => {
    setAreas(null); setAreaId(null)
    const { data, error: loadError } = await supabase
      .from('hazardous_waste_areas')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .eq('area_type', draft.areaType)
      .is('archived_at', null)
      .order('name', { ascending: true })
    if (loadError) { setError(loadError.message); setAreas([]); return }
    setAreas((data ?? []) as AreaOption[])
  }, [tenantId, draft.areaType])

  useEffect(() => { void loadAreas() }, [loadAreas])

  async function onSubmit() {
    if (!areaId) { setError('Choose the area this inspection covers.'); return }
    setBusy(true); setError(null)
    try {
      const res = await fetch(`${apiBase()}/api/hazardous-waste/inspections`, {
        method:  'POST',
        headers: await authHeaders(tenantId),
        body: JSON.stringify({
          area_id:           areaId,
          findings:          findingsFromDraft(draft),
          container_label:   draft.containerLabel,
          waste_description: draft.wasteDescription,
          observations:      draft.observations,
          status:            'submitted',
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`)
      setDone(true)
      onSubmitted()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not submit the inspection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Submit to Soteria</Text>
      <ErrorBanner message={error} />
      {done ? (
        <Text style={styles.success}>Inspection submitted. The local draft was cleared.</Text>
      ) : areas === null ? (
        <ActivityIndicator />
      ) : areas.length === 0 ? (
        <Text style={formStyles.rowMeta}>
          No {HAZARDOUS_WASTE_AREA_LABEL[draft.areaType].toLowerCase()} areas are set up. An administrator can add one on the web; until then, save the draft on this device.
        </Text>
      ) : (
        <>
          <Text style={formStyles.rowMeta}>Area</Text>
          {areas.map(area => {
            const active = area.id === areaId
            return (
              <Pressable key={area.id} onPress={() => setAreaId(area.id)} accessibilityRole="button" accessibilityState={{ selected: active }}>
                <View style={[formStyles.card, active && styles.active]}>
                  <Text style={formStyles.rowTitle}>{area.name}</Text>
                </View>
              </Pressable>
            )
          })}
          <PrimaryButton label="Submit inspection" onPress={onSubmit} busy={busy} disabled={!areaId} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  title: { fontSize: 13, fontWeight: '800', textTransform: 'uppercase', color: '#475569' },
  active: { borderColor: '#1e3a8a', backgroundColor: 'rgba(30, 58, 138, 0.06)' },
  success: { color: '#047857', fontSize: 13, fontWeight: '600' },
})
