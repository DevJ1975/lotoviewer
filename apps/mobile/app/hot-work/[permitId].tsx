import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, ScrollView, StyleSheet } from 'react-native'

import { Centered, ErrorBanner, PrimaryButton, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatShortDateTime } from '@/lib/dateFormat'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/lib/useNow'
import {
  evaluateSignGates,
  hotWorkCountdown,
  hotWorkState,
  type HotWorkState,
} from '@soteria/core/hotWorkPermitStatus'
import { parseTrainingRequiredError } from '@soteria/core/permitTrainingGate'
import { HOT_WORK_TYPE_LABELS, type HotWorkPermit } from '@soteria/core/types'

// Working a hot-work permit from the field: status and countdown, the PAI
// signature (blocked by the same gates the web page applies), and starting
// the post-work fire watch. Creating a permit and the fire-watch sign-on stay
// on the web. The database training gate enforces crew training on signature
// regardless of this screen.

const STATE_LABEL: Record<HotWorkState, string> = {
  pending_signature:   'Awaiting PAI signature',
  active:              'Active',
  expired:             'Expired',
  post_work_watch:     'Post-work fire watch in progress',
  post_watch_complete: 'Fire watch complete: ready to close',
  canceled:            'Canceled',
}
const STATE_COLOR: Record<HotWorkState, string> = {
  pending_signature: '#b45309', active: '#047857', expired: '#b91c1c',
  post_work_watch: '#b45309', post_watch_complete: '#047857', canceled: '#475569',
}

export default function HotWorkPermitScreen() {
  return (
    <ModuleGate featureId="hot-work" name="Hot work">
      <PermitDetail />
    </ModuleGate>
  )
}

function PermitDetail() {
  const { permitId } = useLocalSearchParams<{ permitId: string }>()
  const { tenant } = useTenant()
  const { userId } = useAuth()
  const now = useNow(1000)

  const [permit, setPermit] = useState<HotWorkPermit | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'sign' | 'complete' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id || !permitId) return
    const { data, error: loadError } = await supabase
      .from('loto_hot_work_permits').select('*')
      .eq('tenant_id', tenant.id).eq('id', permitId).maybeSingle()
    if (loadError) setError(loadError.message)
    setPermit((data as HotWorkPermit | null) ?? null)
    setLoading(false)
  }, [tenant?.id, permitId])

  useEffect(() => { void load() }, [load])

  const signBlocks = useMemo(() => (permit ? evaluateSignGates(permit) : []), [permit])

  async function update(patch: Partial<HotWorkPermit>, action: 'sign' | 'complete') {
    if (!permit) return
    setBusy(action); setError(null)
    const { data, error: updateError } = await supabase
      .from('loto_hot_work_permits')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', permit.id).select('*').single()
    setBusy(null)
    if (updateError || !data) {
      setError(parseTrainingRequiredError(updateError?.message) ?? updateError?.message ?? 'Could not update the permit.')
      return
    }
    setPermit(data as HotWorkPermit)
  }

  // The web page makes the signer acknowledge crew-training status before
  // authorizing (NFPA 51B §(g)). A tenant using the STRIKE training gate is
  // also enforced by the database on signature; this prompt covers the rest.
  function confirmSign() {
    Alert.alert(
      'Authorize this permit?',
      'Confirm you have verified that every hot-work operator and fire watcher listed holds current training.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Authorize', onPress: () => { void update({ pai_signature_at: new Date().toISOString() }, 'sign') } },
      ],
    )
  }

  function confirmComplete() {
    if (!permit) return
    Alert.alert(
      'Mark work complete?',
      `This starts the ${permit.post_watch_minutes}-minute post-work fire watch. The fire watcher must stay on duty until it ends.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark complete', onPress: () => { void update({ work_completed_at: new Date().toISOString() }, 'complete') } },
      ],
    )
  }

  if (loading) return <Centered><ActivityIndicator /></Centered>
  if (!permit) return <Centered><Text style={formStyles.empty}>{error ?? 'Permit not found.'}</Text></Centered>

  const state = hotWorkState(permit, now)
  const countdown = hotWorkCountdown(permit, now)
  const isAuthorizer = userId === permit.pai_id

  return (
    <ScrollView contentContainerStyle={formStyles.content}>
      <ErrorBanner message={error} />
      <Text style={formStyles.mono}>{permit.serial}</Text>
      <Text style={{ fontSize: 18, fontWeight: '700' }}>{permit.work_location}</Text>
      <Text>{permit.work_description}</Text>

      <View style={formStyles.card}>
        <Text style={[styles.state, { color: STATE_COLOR[state] }]}>{STATE_LABEL[state]}</Text>
        {countdown.activeMinutesRemaining !== null ? (
          <Text style={formStyles.rowMeta}>{countdown.activeMinutesRemaining} min until the permit expires</Text>
        ) : null}
        {countdown.postWatchMinutesRemaining !== null ? (
          <Text style={formStyles.rowMeta}>{countdown.postWatchMinutesRemaining} min of fire watch remaining</Text>
        ) : null}
        <Text style={formStyles.rowMeta}>Expires {formatShortDateTime(permit.expires_at)}</Text>
      </View>

      <View style={formStyles.card}>
        <Text style={formStyles.rowTitle}>Work</Text>
        <Text style={formStyles.rowMeta}>{permit.work_types.map(t => HOT_WORK_TYPE_LABELS[t] ?? t).join(', ') || 'None selected'}</Text>
        <Text style={formStyles.rowTitle}>Operators</Text>
        <Text style={formStyles.rowMeta}>{permit.hot_work_operators.join(', ') || 'None'}</Text>
        <Text style={formStyles.rowTitle}>Fire watch</Text>
        <Text style={formStyles.rowMeta}>{permit.fire_watch_personnel.join(', ') || 'None'}</Text>
      </View>

      {state === 'pending_signature' ? (
        <View style={{ gap: 8 }}>
          {signBlocks.map(block => <Text key={block.code} style={styles.blocker}>{block.message}</Text>)}
          {!isAuthorizer ? <Text style={formStyles.rowMeta}>Only the permit authorizing individual can sign.</Text> : null}
          <PrimaryButton
            label="Sign as authorizing individual"
            onPress={confirmSign}
            busy={busy === 'sign'}
            disabled={signBlocks.length > 0 || !isAuthorizer}
          />
        </View>
      ) : null}

      {state === 'active' ? (
        <PrimaryButton label="Mark work complete" onPress={confirmComplete} busy={busy === 'complete'} />
      ) : null}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  state: { fontSize: 15, fontWeight: '700' },
  blocker: { color: '#92400E', fontSize: 13 },
})
