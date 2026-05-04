import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import type { Tenant, TenantRole } from '@soteria/core/types'

// Modal-presented tenant switcher. Tapping a row writes the chosen
// tenant id to SecureStore (via setActiveTenant inside the provider)
// and dismisses. The next Supabase call from any screen carries the
// new x-active-tenant header automatically — we don't need to do a
// page reload like the web does, because RN doesn't keep stale
// in-flight requests in flight across navigation.

export default function TenantSwitcherScreen() {
  const router = useRouter()
  const { available, tenantId, switchTenant, loading } = useTenant()

  async function pick(id: string) {
    if (id === tenantId) {
      router.back()
      return
    }
    await switchTenant(id)
    router.back()
  }

  return (
    <View style={styles.container}>
      <FlatList<Tenant & { role: TenantRole }>
        data={available}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>
              {loading ? 'Loading memberships…' : 'You are not a member of any active tenant.'}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const active = item.id === tenantId
          return (
            <Pressable onPress={() => { void pick(item.id) }}>
              {({ pressed }) => (
                <View style={[styles.row, pressed && styles.rowPressed, active && styles.rowActive]}>
                  <Text style={styles.rowNumber}>{item.tenant_number ?? '----'}</Text>
                  <View style={styles.rowBody}>
                    <Text style={styles.rowName}>{item.name}</Text>
                    <Text style={styles.rowRole}>{item.role}</Text>
                  </View>
                  {active ? <Text style={styles.activeMark}>✓</Text> : null}
                </View>
              )}
            </Pressable>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  container:    { flex: 1 },
  center:       { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  muted:        { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  row:          { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },
  rowPressed:   { opacity: 0.6 },
  rowActive:    { backgroundColor: '#eef2ff' },
  rowNumber:    { fontFamily: 'SpaceMono', fontSize: 13, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#1e3a8a', color: '#fff', borderRadius: 6 },
  rowBody:      { flex: 1 },
  rowName:      { fontSize: 15, fontWeight: '600' },
  rowRole:      { fontSize: 11, opacity: 0.55, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
  activeMark:   { fontSize: 22, color: '#1e3a8a', fontWeight: '700' },
})
