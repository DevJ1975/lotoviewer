import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet } from 'react-native'

import { Text, View } from '@/components/Themed'

// Small form kit shared by the field-capture screens (incidents, BBS,
// inspections, permits). Styles match the near-miss form so the app reads as
// one product.

const NAVY = '#1e3a8a'

export function Field({ label, hint, required, children }: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
}) {
  return (
    <View style={styles.field}>
      <View style={styles.fieldHeader}>
        <Text style={styles.fieldLabel}>
          {label}
          {required ? <Text style={styles.required}> *</Text> : null}
        </Text>
        {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  )
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <View style={styles.errorBox} accessibilityRole="alert">
      <Text style={styles.errorText}>{message}</Text>
    </View>
  )
}

export function PrimaryButton({ label, onPress, busy, disabled, tone = 'primary' }: {
  label: string
  onPress: () => void
  busy?: boolean
  disabled?: boolean
  tone?: 'primary' | 'danger'
}) {
  const inactive = busy || disabled
  return (
    <Pressable onPress={onPress} disabled={inactive} accessibilityRole="button" accessibilityState={{ disabled: !!inactive, busy: !!busy }}>
      {({ pressed }) => (
        <View style={[
          styles.button,
          tone === 'danger' && styles.buttonDanger,
          pressed && { opacity: 0.85 },
          inactive && { opacity: 0.5 },
        ]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{label}</Text>}
        </View>
      )}
    </Pressable>
  )
}

export function ChipSelect<T extends string>({ options, value, onChange, labelFor }: {
  options: readonly T[]
  value: T | ''
  onChange: (next: T) => void
  labelFor?: (option: T) => string
}) {
  return (
    <View style={styles.chipRow}>
      {options.map(option => {
        const active = value === option
        return (
          <Pressable key={option} onPress={() => onChange(option)} accessibilityRole="button" accessibilityState={{ selected: active }}>
            {({ pressed }) => (
              <View style={[styles.chip, active && styles.chipActive, pressed && { opacity: 0.6 }]}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {labelFor ? labelFor(option) : option.replace(/_/g, ' ')}
                </Text>
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

export function Centered({ children }: { children: ReactNode }) {
  return <View style={styles.centered}>{children}</View>
}

export const formStyles = StyleSheet.create({
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  input: { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  subtitle: { fontSize: 13, opacity: 0.7 },
  card: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', gap: 6 },
  rowTitle: { fontSize: 14, fontWeight: '600' },
  rowMeta: { fontSize: 11, opacity: 0.6 },
  mono: { fontFamily: 'SpaceMono', fontSize: 11, opacity: 0.6 },
  empty: { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  fab: { position: 'absolute', right: 16, bottom: 24, paddingHorizontal: 20, paddingVertical: 14, borderRadius: 28, backgroundColor: NAVY, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 14 },
})

const styles = StyleSheet.create({
  field: { gap: 6 },
  fieldHeader: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600' },
  fieldHint: { fontSize: 11, opacity: 0.5, flexShrink: 1 },
  required: { color: '#DC2626' },
  errorBox: { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText: { color: '#7F1D1D', fontSize: 13 },
  button: { paddingVertical: 14, borderRadius: 12, backgroundColor: NAVY, alignItems: 'center' },
  buttonDanger: { backgroundColor: '#b91c1c' },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#cbd5e1' },
  chipActive: { borderColor: NAVY, backgroundColor: NAVY },
  chipText: { fontSize: 12, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 24 },
})
