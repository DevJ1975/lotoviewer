import FontAwesome from '@expo/vector-icons/FontAwesome'
import { Link, type Href } from 'expo-router'
import { Pressable, ScrollView, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// Home hub: the active workspace, one-tap "report" actions for the things a
// worker files most, and a tile for every module the workspace has enabled.
// Modules a tenant has switched off are hidden here, matching the web drawer.

interface Destination {
  featureId: string
  title:     string
  href:      Href
  icon:      React.ComponentProps<typeof FontAwesome>['name']
}

const QUICK_REPORTS: readonly Destination[] = [
  { featureId: 'incidents',  title: 'Report incident', href: '/incidents/new',  icon: 'ambulance' },
  { featureId: 'near-miss',  title: 'Near-miss',       href: '/near-miss/new',  icon: 'exclamation-triangle' },
  { featureId: 'bbs',        title: 'Observe',         href: '/bbs/new',        icon: 'eye' },
]

const MODULES: readonly Destination[] = [
  { featureId: 'incidents',       title: 'Incidents',        href: '/incidents',        icon: 'ambulance' },
  { featureId: 'near-miss',       title: 'Near-miss',        href: '/near-miss',        icon: 'exclamation-triangle' },
  { featureId: 'bbs',             title: 'Observations',     href: '/bbs',              icon: 'eye' },
  { featureId: 'inspections',     title: 'Inspections',      href: '/inspections',      icon: 'check-square-o' },
  { featureId: 'jha',             title: 'JHA',              href: '/jha',              icon: 'list-alt' },
  { featureId: 'risk-assessment', title: 'Risk',             href: '/risk',             icon: 'shield' },
  { featureId: 'loto',            title: 'Equipment',        href: '/equipment',        icon: 'cogs' },
  { featureId: 'loto',            title: 'LOTO devices',     href: '/loto-devices',     icon: 'key' },
  { featureId: 'hazardous-waste', title: 'Hazardous waste',  href: '/hazardous-waste',  icon: 'recycle' },
]

export default function HomeScreen() {
  const { tenant, available, loading } = useTenant()
  const visible = (d: Destination) => isModuleVisible(d.featureId, tenant?.modules)
  const quick = QUICK_REPORTS.filter(visible)
  const modules = MODULES.filter(visible)

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Link href="/tenant-switcher" asChild>
        <Pressable accessibilityRole="button">
          {({ pressed }) => (
            <View style={[styles.tenantPill, pressed && { opacity: 0.6 }]}>
              <Text style={styles.tenantNumber}>{tenant?.tenant_number ?? '----'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.tenantName}>{loading ? 'Loading…' : (tenant?.name ?? 'No workspace selected')}</Text>
                <Text style={styles.tenantHint}>{available.length > 1 ? 'Tap to switch' : 'Active workspace'}</Text>
              </View>
            </View>
          )}
        </Pressable>
      </Link>

      {quick.length > 0 ? (
        <View style={styles.quickRow}>
          {quick.map(d => (
            <Link key={d.title} href={d.href} asChild>
              <Pressable accessibilityRole="button" style={{ flex: 1 }}>
                {({ pressed }) => (
                  <View style={[styles.quick, pressed && { opacity: 0.8 }]}>
                    <FontAwesome name={d.icon} size={22} color="#fff" />
                    <Text style={styles.quickText}>{d.title}</Text>
                  </View>
                )}
              </Pressable>
            </Link>
          ))}
        </View>
      ) : null}

      <View style={styles.grid}>
        {modules.map(d => (
          <Link key={d.title} href={d.href} asChild>
            <Pressable accessibilityRole="button" style={styles.tileWrap}>
              {({ pressed }) => (
                <View style={[styles.tile, pressed && { opacity: 0.7 }]}>
                  <FontAwesome name={d.icon} size={24} color="#1e3a8a" />
                  <Text style={styles.tileText}>{d.title}</Text>
                </View>
              )}
            </Pressable>
          </Link>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  tenantPill: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1' },
  tenantNumber: { fontFamily: 'SpaceMono', fontSize: 14, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: '#1e3a8a', color: '#fff', borderRadius: 6 },
  tenantName: { fontSize: 14, fontWeight: '600' },
  tenantHint: { fontSize: 11, opacity: 0.6, marginTop: 2 },
  quickRow: { flexDirection: 'row', gap: 10 },
  quick: { alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 16, borderRadius: 14, backgroundColor: '#1e3a8a' },
  quickText: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tileWrap: { width: '48%' },
  tile: { alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', minHeight: 88 },
  tileText: { fontSize: 14, fontWeight: '600' },
})
