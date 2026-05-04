import * as Linking from 'expo-linking'
import { Link } from 'expo-router'
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
import { supabase } from '@/lib/supabase'

// Mobile mirror of apps/web/app/forgot-password/page.tsx.
//
// We send the user back to the WEB /reset-password URL because:
// 1. Supabase's reset link points at a redirectTo URL that must be on
//    the project's allowlist in Supabase's URL config.
// 2. The web app's existing /reset-password screen handles the
//    PASSWORD_RECOVERY event end-to-end.
// 3. Once Universal Links / App Links are wired (see deferred D2.2),
//    tapping the email link from Mail will open this app instead of
//    Safari/Chrome — at which point the user is back inside the
//    native shell.

const WEB_BASE_URL =
  process.env.EXPO_PUBLIC_WEB_BASE_URL ||
  'https://soteriafield.app'

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('')
  const [busy,  setBusy]  = useState(false)
  const [done,  setDone]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    if (busy) return
    setBusy(true); setError(null)
    const { error: err } = await supabase.auth.resetPasswordForEmail(
      email.trim().toLowerCase(),
      { redirectTo: `${WEB_BASE_URL}/reset-password` },
    )
    setBusy(false)
    if (err) setError(err.message)
    else setDone(true)
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Forgot your password?</Text>
        <Text style={styles.subtitle}>We&apos;ll email you a link to reset it.</Text>

        {done ? (
          <>
            <View style={styles.successBox}>
              <Text style={styles.successTitle}>Check your inbox.</Text>
              <Text style={styles.successBody}>
                If an account exists for {email}, a reset link is on the way.
                The link expires in one hour.
              </Text>
            </View>
            <TouchableOpacity onPress={() => setDone(false)}>
              <Text style={styles.linkSmall}>Try a different email</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, (!email || busy) && styles.buttonDisabled]}
              disabled={!email || busy}
              onPress={onSubmit}
            >
              {busy
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.buttonText}>Send reset link</Text>}
            </TouchableOpacity>
          </>
        )}

        <Link href="/login" style={styles.linkSmall}>
          Back to sign in
        </Link>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root:           { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: '#f8fafc' },
  card:           { width: '100%', maxWidth: 380, backgroundColor: '#fff', padding: 24, borderRadius: 16, gap: 12 },
  title:          { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  subtitle:       { fontSize: 14, color: '#64748b', marginBottom: 8 },
  label:          { fontSize: 12, fontWeight: '600', color: '#475569' },
  input:          { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff', color: '#0f172a' },
  error:          { fontSize: 13, color: '#b91c1c', backgroundColor: '#fef2f2', padding: 8, borderRadius: 8 },
  button:         { marginTop: 8, backgroundColor: '#1e3a8a', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  buttonDisabled: { opacity: 0.4 },
  buttonText:     { color: '#fff', fontSize: 14, fontWeight: '600' },
  linkSmall:      { fontSize: 12, color: '#1e3a8a', marginTop: 8, textAlign: 'center' },
  successBox:     { backgroundColor: '#ecfdf5', borderColor: '#a7f3d0', borderWidth: 1, padding: 12, borderRadius: 8, gap: 4 },
  successTitle:   { fontSize: 14, fontWeight: '600', color: '#065f46' },
  successBody:    { fontSize: 12, color: '#047857' },
})
