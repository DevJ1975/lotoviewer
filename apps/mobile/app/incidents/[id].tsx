import { useLocalSearchParams } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, ScrollView } from 'react-native'

import { Centered, ErrorBanner, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { formatShortDateTime } from '@/lib/dateFormat'
import { supabase } from '@/lib/supabase'
import {
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  STATUS_LABEL,
  type IncidentRow,
} from '@soteria/core/incident'

export default function IncidentDetailScreen() {
  return (
    <ModuleGate featureId="incidents" name="Incidents">
      <IncidentDetail />
    </ModuleGate>
  )
}

function IncidentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { tenant } = useTenant()
  const [row, setRow] = useState<IncidentRow | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!tenant?.id || !id) return
    let cancelled = false
    void (async () => {
      const { data, error: err } = await supabase
        .from('incidents')
        .select('*')
        .eq('tenant_id', tenant.id)
        .eq('id', id)
        .maybeSingle()
      if (cancelled) return
      if (err) setError(err.message)
      setRow((data as IncidentRow | null) ?? null)
    })()
    return () => { cancelled = true }
  }, [tenant?.id, id])

  if (row === undefined && !error) return <Centered><ActivityIndicator /></Centered>
  if (!row) return <Centered><Text style={formStyles.empty}>{error ?? 'Not found.'}</Text></Centered>

  return (
    <ScrollView contentContainerStyle={formStyles.content}>
      <ErrorBanner message={error} />
      <Text style={formStyles.mono}>{row.report_number}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>{INCIDENT_TYPE_LABEL[row.incident_type]}</Text>
      <Text>{row.description}</Text>

      <View style={formStyles.card}>
        <Meta label="Status" value={STATUS_LABEL[row.status]} />
        <Meta label="Outcome" value={SEVERITY_ACTUAL_LABEL[row.severity_actual]} />
        <Meta label="Potential" value={row.severity_potential} />
        <Meta label="Occurred" value={formatShortDateTime(row.occurred_at)} />
        <Meta label="Reported" value={formatShortDateTime(row.reported_at)} />
        <Meta label="Location" value={row.location_text} />
        <Meta label="Shift" value={row.shift} />
      </View>

      {row.immediate_action_taken ? (
        <View style={formStyles.card}>
          <Text style={formStyles.rowMeta}>Immediate action taken</Text>
          <Text>{row.immediate_action_taken}</Text>
        </View>
      ) : null}
    </ScrollView>
  )
}

function Meta({ label, value }: { label: string; value: string | null }) {
  if (!value) return null
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
      <Text style={formStyles.rowMeta}>{label}</Text>
      <Text style={{ fontSize: 13, flexShrink: 1, textAlign: 'right', textTransform: 'capitalize' }}>{value}</Text>
    </View>
  )
}
