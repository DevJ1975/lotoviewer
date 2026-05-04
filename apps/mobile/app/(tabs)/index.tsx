import { Link } from 'expo-router'
import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, TouchableOpacity } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

// Phase 3 dashboard. Read-only summary:
//   - Greeting (signed-in user's email).
//   - Active tenant pill (taps open the switcher modal).
//   - Equipment count for the active tenant.
//   - Sign out.
//
// Counts come from a HEAD-only count() query so we don't pull rows
// just to render a number.

export default function DashboardScreen() {
  const { session, signOut } = useAuth()
  const { tenant, available, loading: tenantLoading } = useTenant()
  const [equipmentCount, setEquipmentCount] = useState<number | null>(null)
  const [countError,     setCountError]     = useState<string | null>(null)

  const email = session?.user?.email ?? '—'

  useEffect(() => {
    let cancelled = false
    if (!tenant?.id) {
      setEquipmentCount(null)
      return
    }
    async function loadCount() {
      setCountError(null)
      const { count, error } = await supabase
        .from('loto_equipment')
        .select('*', { count: 'exact', head: true })
      if (cancelled) return
      if (error) {
        setCountError(error.message)
        setEquipmentCount(null)
        return
      }
      setEquipmentCount(count ?? 0)
    }
    void loadCount()
    return () => { cancelled = true }
  }, [tenant?.id])

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.greetingSmall}>Signed in as</Text>
        <Text style={styles.greetingLarge}>{email}</Text>
      </View>

      <Link href="/tenant-switcher" asChild>
        <Pressable>
          {({ pressed }) => (
            <View style={[styles.tenantPill, pressed && styles.tenantPillPressed]}>
              <Text style={styles.tenantPillNumber}>
                {tenant?.tenant_number ?? '----'}
              </Text>
              <View style={styles.tenantPillBody}>
                <Text style={styles.tenantPillName}>
                  {tenantLoading ? 'Loading…' : (tenant?.name ?? 'No tenant selected')}
                </Text>
                <Text style={styles.tenantPillHint}>
                  {available.length > 1 ? 'Tap to switch' : 'Active tenant'}
                </Text>
              </View>
            </View>
          )}
        </Pressable>
      </Link>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Equipment</Text>
          {countError ? (
            <Text style={styles.statError}>error</Text>
          ) : equipmentCount === null ? (
            <ActivityIndicator />
          ) : (
            <Text style={styles.statValue}>{equipmentCount}</Text>
          )}
        </View>
      </View>

      <View style={styles.spacer} />

      <TouchableOpacity style={styles.signOutBtn} onPress={() => { void signOut() }}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container:          { flex: 1, padding: 16, gap: 16 },
  header:             { gap: 4, paddingTop: 8 },
  greetingSmall:      { fontSize: 12, opacity: 0.6 },
  greetingLarge:      { fontSize: 18, fontWeight: '600' },
  tenantPill:         { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  tenantPillPressed:  { opacity: 0.6 },
  tenantPillNumber:   { fontFamily: 'SpaceMono', fontSize: 14, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#1e3a8a', color: '#fff', borderRadius: 6 },
  tenantPillBody:     { flex: 1 },
  tenantPillName:     { fontSize: 14, fontWeight: '600' },
  tenantPillHint:     { fontSize: 11, opacity: 0.6, marginTop: 2 },
  statsRow:           { flexDirection: 'row', gap: 12 },
  statCard:           { flex: 1, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', alignItems: 'flex-start', gap: 4 },
  statLabel:          { fontSize: 11, fontWeight: '600', opacity: 0.6, textTransform: 'uppercase', letterSpacing: 0.5 },
  statValue:          { fontSize: 28, fontWeight: '700' },
  statError:          { fontSize: 12, color: '#b91c1c' },
  spacer:             { flex: 1 },
  signOutBtn:         { alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8' },
  signOutText:        { fontSize: 14, fontWeight: '600' },
})
