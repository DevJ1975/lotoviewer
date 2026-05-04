import { Link, useRouter } from 'expo-router'
import { useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { useAuth } from '@/components/AuthProvider'

// Mobile mirror of apps/web/app/login/page.tsx. Same Supabase
// signInWithPassword call routed through the @soteria/core client.
//
// On successful sign-in, the AuthProvider's onAuthStateChange fires,
// AuthGate sees userId and bounces from /login → /(tabs).

export default function LoginScreen() {
  const router = useRouter()
  const { signIn } = useAuth()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function onSubmit() {
    if (busy) return
    setBusy(true); setError(null)
    const { error } = await signIn(email, password)
    setBusy(false)
    if (error) setError(error)
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Soteria FIELD</Text>
        <Text style={styles.subtitle}>Sign in to continue</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!busy}
        />

        <View style={styles.passwordHeaderRow}>
          <Text style={styles.label}>Password</Text>
          <Link href="/forgot-password" style={styles.linkSmall}>
            Forgot password?
          </Link>
        </View>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          secureTextEntry
          editable={!busy}
        />

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.button, (!email || !password || busy) && styles.buttonDisabled]}
          disabled={!email || !password || busy}
          onPress={onSubmit}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Sign in</Text>}
        </TouchableOpacity>

        <Text style={styles.footnote}>
          Access is by invitation only. Contact your administrator if you need an account.
        </Text>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root:               { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#f8fafc' },
  card:               { width: '100%', maxWidth: 380, backgroundColor: '#fff', padding: 24, borderRadius: 16, gap: 12 },
  title:              { fontSize: 22, fontWeight: '700', textAlign: 'center', color: '#0f172a' },
  subtitle:           { fontSize: 14, color: '#64748b', textAlign: 'center', marginBottom: 8 },
  label:              { fontSize: 12, fontWeight: '600', color: '#475569', marginTop: 8 },
  passwordHeaderRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  linkSmall:          { fontSize: 12, color: '#1e3a8a' },
  input:              { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff', color: '#0f172a' },
  error:              { fontSize: 13, color: '#b91c1c', backgroundColor: '#fef2f2', padding: 8, borderRadius: 8 },
  button:             { marginTop: 8, backgroundColor: '#1e3a8a', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled:     { opacity: 0.4 },
  buttonText:         { color: '#fff', fontSize: 14, fontWeight: '600' },
  footnote:           { fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 12 },
})
