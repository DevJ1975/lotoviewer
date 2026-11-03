import Constants from 'expo-constants'
import { Link } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet } from 'react-native'

import { ErrorBanner, PrimaryButton, formStyles } from '@/components/form'
import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { pendingDeletionRequestedAt, requestAccountDeletion } from '@/lib/accountDeletion'
import { webUrl } from '@/lib/api'
import { formatShortDate } from '@/lib/dateFormat'

// Account, legal links and account deletion. The deletion request is required
// for App Store review: it must be startable inside the app.

const LEGAL_LINKS: ReadonlyArray<{ label: string; path: string }> = [
  { label: 'Privacy policy',  path: '/privacy' },
  { label: 'Terms of service', path: '/terms' },
  { label: 'Support',          path: '/support' },
]

export default function AccountScreen() {
  const { session, userId, signOut } = useAuth()
  const { tenant, tenantId, available } = useTenant()
  const [deletionRequestedAt, setDeletionRequestedAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    void pendingDeletionRequestedAt(userId).then(at => { if (!cancelled) setDeletionRequestedAt(at) })
    return () => { cancelled = true }
  }, [userId])

  function confirmDeletion() {
    Alert.alert(
      'Request account deletion?',
      'Your personal data will be removed within 30 days. Safety records such as incidents, permits and training are retained as required by OSHA and are anonymized. You will be signed out.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Request deletion', style: 'destructive', onPress: () => { void submitDeletion() } },
      ],
    )
  }

  async function submitDeletion() {
    if (!tenantId) { setError('Select a workspace first.'); return }
    setBusy(true); setError(null)
    try {
      const requestedAt = await requestAccountDeletion(tenantId, null)
      setDeletionRequestedAt(requestedAt)
      await signOut()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request.')
      setBusy(false)
    }
  }

  return (
    <ScrollView contentContainerStyle={formStyles.content}>
      <View style={formStyles.card}>
        <Text style={formStyles.rowMeta}>Signed in as</Text>
        <Text style={styles.email}>{session?.user?.email ?? '—'}</Text>
        <Text style={formStyles.rowMeta}>Workspace</Text>
        <Text style={formStyles.rowTitle}>{tenant?.name ?? 'No workspace selected'}</Text>
        {available.length > 1 ? (
          <Link href="/tenant-switcher" asChild>
            <Pressable accessibilityRole="button">
              <Text style={styles.link}>Switch workspace</Text>
            </Pressable>
          </Link>
        ) : null}
      </View>

      <View style={formStyles.card}>
        {LEGAL_LINKS.map(link => (
          <Pressable key={link.path} onPress={() => { void WebBrowser.openBrowserAsync(webUrl(link.path)) }} accessibilityRole="link">
            <Text style={styles.link}>{link.label}</Text>
          </Pressable>
        ))}
      </View>

      <PrimaryButton label="Sign out" onPress={() => { void signOut() }} />

      <View style={[formStyles.card, styles.danger]}>
        <Text style={styles.dangerTitle}>Delete account</Text>
        {deletionRequestedAt ? (
          <Text style={formStyles.rowMeta}>
            Deletion requested on {formatShortDate(deletionRequestedAt)}. Your data will be removed within 30 days.
          </Text>
        ) : (
          <>
            <Text style={formStyles.rowMeta}>
              Ask us to delete your account and personal data. Safety records are retained as OSHA requires.
            </Text>
            <ErrorBanner message={error} />
            <PrimaryButton label="Request account deletion" onPress={confirmDeletion} busy={busy} tone="danger" />
          </>
        )}
      </View>

      <Text style={styles.version}>
        Soteria FIELD {Constants.expoConfig?.version ?? ''}
      </Text>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  email: { fontSize: 16, fontWeight: '600' },
  link: { fontSize: 15, fontWeight: '600', color: '#1e3a8a', paddingVertical: 8 },
  danger: { borderColor: '#FCA5A5' },
  dangerTitle: { fontSize: 14, fontWeight: '700', color: '#b91c1c' },
  version: { textAlign: 'center', fontSize: 12, opacity: 0.5 },
})
