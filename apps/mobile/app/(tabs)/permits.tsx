import { Link, useFocusEffect } from 'expo-router'
import { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet } from 'react-native'

import { Centered, ErrorBanner, formStyles } from '@/components/form'
import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useModuleVisible } from '@/lib/modules'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/lib/useNow'
import { permitState } from '@soteria/core/confinedSpaceThresholds'
import { hotWorkCountdown, hotWorkState, hotWorkTone, type HotWorkState } from '@soteria/core/hotWorkPermitStatus'
import { permitCountdown, type CountdownTone } from '@soteria/core/permitStatus'
import type { ConfinedSpacePermit, HotWorkPermit } from '@soteria/core/types'

// Live board of the permits a worker or supervisor is likely to need in the
// field. Creating a permit is a web workflow; this tab is for working an
// existing one (atmospheric tests, entrant log, sign-off, close-out).

type CsRow = Pick<ConfinedSpacePermit, 'id' | 'serial' | 'purpose' | 'expires_at' | 'canceled_at' | 'entry_supervisor_signature_at'>
type HwRow = Pick<HotWorkPermit,
  'id' | 'serial' | 'work_location' | 'work_description' | 'expires_at' | 'canceled_at'
  | 'pai_signature_at' | 'work_completed_at' | 'post_watch_minutes'>

const TONE_COLOR: Record<CountdownTone | 'neutral', string> = {
  safe: '#047857', warning: '#b45309', critical: '#b91c1c', expired: '#b91c1c', neutral: '#475569',
}
const HW_STATE_LABEL: Record<HotWorkState, string> = {
  pending_signature: 'Awaiting signature', active: 'Active', expired: 'Expired',
  post_work_watch: 'Post-work fire watch', post_watch_complete: 'Ready to close', canceled: 'Canceled',
}
const CS_STATE_LABEL = {
  pending_signature: 'Awaiting signature', active: 'Active', expired: 'Expired', canceled: 'Canceled',
} as const

const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000

export default function PermitsScreen() {
  const { tenant } = useTenant()
  const showCs = useModuleVisible('confined-spaces')
  const showHot = useModuleVisible('hot-work')
  const now = useNow(1000)
  const [cs, setCs] = useState<CsRow[] | null>(null)
  const [hot, setHot] = useState<HwRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const load = useCallback(async () => {
    if (!tenant?.id) { setCs([]); setHot([]); return }
    setError(null)
    const since = new Date(Date.now() - RECENT_WINDOW_MS).toISOString()
    const [csResult, hotResult] = await Promise.all([
      showCs
        ? supabase.from('loto_confined_space_permits')
            .select('id, serial, purpose, expires_at, canceled_at, entry_supervisor_signature_at')
            .eq('tenant_id', tenant.id).is('canceled_at', null).gte('expires_at', since)
            .order('expires_at', { ascending: true }).limit(100)
        : Promise.resolve({ data: [], error: null }),
      showHot
        ? supabase.from('loto_hot_work_permits')
            .select('id, serial, work_location, work_description, expires_at, canceled_at, pai_signature_at, work_completed_at, post_watch_minutes')
            .eq('tenant_id', tenant.id).is('canceled_at', null).gte('created_at', since)
            .order('expires_at', { ascending: true }).limit(100)
        : Promise.resolve({ data: [], error: null }),
    ])
    const failure = csResult.error ?? hotResult.error
    if (failure) { setError(failure.message); setCs(null); setHot(null); return }
    setCs((csResult.data ?? []) as CsRow[])
    setHot(((hotResult.data ?? []) as HwRow[]).filter(p => hotWorkState(p) !== 'post_watch_complete'))
  }, [tenant?.id, showCs, showHot])

  useFocusEffect(useCallback(() => { void load() }, [load]))

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  if (!showCs && !showHot) {
    return <Centered><Text style={formStyles.empty}>Permits are not enabled for this workspace.</Text></Centered>
  }
  if (cs === null && hot === null && !error) return <Centered><ActivityIndicator /></Centered>

  const empty = (cs?.length ?? 0) === 0 && (hot?.length ?? 0) === 0

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <ErrorBanner message={error} />
      {empty && !error ? <Text style={[formStyles.empty, { marginTop: 32 }]}>No open permits right now.</Text> : null}

      {(cs?.length ?? 0) > 0 ? <Text style={styles.section}>Confined space</Text> : null}
      {cs?.map(p => {
        const state = permitState(p)
        const countdown = permitCountdown(p, now)
        return (
          <Link key={p.id} href={{ pathname: '/confined-spaces/[permitId]', params: { permitId: p.id } }} asChild>
            <Pressable>
              {({ pressed }) => (
                <View style={[formStyles.card, pressed && { opacity: 0.7 }]}>
                  <Text style={formStyles.mono}>{p.serial}</Text>
                  <Text style={formStyles.rowTitle} numberOfLines={2}>{p.purpose}</Text>
                  <Text style={[styles.status, { color: TONE_COLOR[countdown.tone] }]}>
                    {CS_STATE_LABEL[state]}{state === 'active' ? ` · ${countdown.label} left` : ''}
                  </Text>
                </View>
              )}
            </Pressable>
          </Link>
        )
      })}

      {(hot?.length ?? 0) > 0 ? <Text style={styles.section}>Hot work</Text> : null}
      {hot?.map(p => {
        const state = hotWorkState(p, now)
        const countdown = hotWorkCountdown(p, now)
        const minutes = countdown.activeMinutesRemaining ?? countdown.postWatchMinutesRemaining
        return (
          <Link key={p.id} href={{ pathname: '/hot-work/[permitId]', params: { permitId: p.id } }} asChild>
            <Pressable>
              {({ pressed }) => (
                <View style={[formStyles.card, pressed && { opacity: 0.7 }]}>
                  <Text style={formStyles.mono}>{p.serial}</Text>
                  <Text style={formStyles.rowTitle} numberOfLines={2}>{p.work_location}: {p.work_description}</Text>
                  <Text style={[styles.status, { color: TONE_COLOR[hotWorkTone(state, countdown)] }]}>
                    {HW_STATE_LABEL[state]}{minutes !== null ? ` · ${minutes} min left` : ''}
                  </Text>
                </View>
              )}
            </Pressable>
          </Link>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 12, gap: 8, paddingBottom: 32 },
  section: { fontSize: 13, fontWeight: '700', opacity: 0.7, marginTop: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  status: { fontSize: 13, fontWeight: '700' },
})
