import { StyleSheet, TouchableOpacity } from 'react-native';

import { Text, View } from '@/components/Themed';
import { useAuth } from '@/components/AuthProvider';

// Phase 2 placeholder dashboard. Phase 3 will replace this with the
// real read-only dashboard (greeting + tenant pill + equipment +
// open-permits counts) sourced from existing apps/web/api/* routes
// via the shared @soteria/core/queries layer.
export default function DashboardScreen() {
  const { session, signOut } = useAuth()
  const email = session?.user?.email ?? '—'

  return (
    <View style={styles.container}>
      <Text style={styles.title}>You are signed in</Text>
      <Text style={styles.subtitle}>{email}</Text>
      <View style={styles.separator} lightColor="#eee" darkColor="rgba(255,255,255,0.1)" />
      <TouchableOpacity style={styles.signOutBtn} onPress={() => { void signOut() }}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  title:        { fontSize: 20, fontWeight: 'bold' },
  subtitle:     { fontSize: 14, marginTop: 4, opacity: 0.7 },
  separator:    { marginVertical: 30, height: 1, width: '80%' },
  signOutBtn:   { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8' },
  signOutText:  { fontSize: 14, fontWeight: '600' },
});
