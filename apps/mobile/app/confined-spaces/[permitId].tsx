import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput } from 'react-native'

import { Centered, ChipSelect, ErrorBanner, Field, PrimaryButton, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatShortDateTime } from '@/lib/dateFormat'
import { supabase } from '@/lib/supabase'
import { useNow } from '@/lib/useNow'
import {
  effectiveThresholds,
  evaluateChannel,
  evaluateTest,
  permitState,
  type ChannelKey,
  type ReadingStatus,
} from '@soteria/core/confinedSpaceThresholds'
import { permitCountdown } from '@soteria/core/permitStatus'
import type {
  AtmosphericTest,
  AtmosphericTestKind,
  ConfinedSpace,
  ConfinedSpaceEntry,
  ConfinedSpacePermit,
} from '@soteria/core/types'

// Working an existing confined-space permit from the field: live status,
// atmospheric readings checked against the permit's thresholds as you type,
// and the entrant in/out log. Writes go straight to Supabase, exactly as the
// web permit page does; push, webhook and training-gate triggers fire in the
// database either way.

const TEST_KINDS: readonly AtmosphericTestKind[] = ['pre_entry', 'periodic', 'post_alarm']
const KIND_LABEL: Record<AtmosphericTestKind, string> = {
  pre_entry: 'Pre-entry', periodic: 'Periodic', post_alarm: 'After alarm',
}
const STATUS_COLOR: Record<ReadingStatus, string> = { pass: '#047857', fail: '#b91c1c', unknown: '#94a3b8' }
const CHANNELS: ReadonlyArray<{ key: ChannelKey; label: string; unit: string }> = [
  { key: 'o2', label: 'O₂', unit: '%' },
  { key: 'lel', label: 'LEL', unit: '%' },
  { key: 'h2s', label: 'H₂S', unit: 'ppm' },
  { key: 'co', label: 'CO', unit: 'ppm' },
]

function parseReading(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  const value = Number(trimmed)
  return Number.isNaN(value) ? null : value
}

export default function ConfinedSpacePermitScreen() {
  return (
    <ModuleGate featureId="confined-spaces" name="Confined spaces">
      <PermitDetail />
    </ModuleGate>
  )
}

function PermitDetail() {
  const { permitId } = useLocalSearchParams<{ permitId: string }>()
  const { tenant } = useTenant()
  const { userId } = useAuth()
  const now = useNow(1000)

  const [permit, setPermit] = useState<ConfinedSpacePermit | null>(null)
  const [space, setSpace] = useState<ConfinedSpace | null>(null)
  const [tests, setTests] = useState<AtmosphericTest[]>([])
  const [entries, setEntries] = useState<ConfinedSpaceEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id || !permitId) return
    setError(null)
    const { data: permitRow, error: permitError } = await supabase
      .from('loto_confined_space_permits').select('*')
      .eq('tenant_id', tenant.id).eq('id', permitId).maybeSingle()
    if (permitError || !permitRow) {
      setError(permitError?.message ?? 'Permit not found.')
      setLoading(false)
      return
    }
    const loaded = permitRow as ConfinedSpacePermit
    const [spaceResult, testResult, entryResult] = await Promise.all([
      supabase.from('loto_confined_spaces').select('*').eq('space_id', loaded.space_id).maybeSingle(),
      supabase.from('loto_atmospheric_tests').select('*').eq('permit_id', permitId).order('tested_at', { ascending: false }),
      supabase.from('loto_confined_space_entries').select('*').eq('permit_id', permitId).order('entered_at', { ascending: false }),
    ])
    const failure = spaceResult.error ?? testResult.error ?? entryResult.error
    if (failure) setError(failure.message)
    setPermit(loaded)
    setSpace((spaceResult.data as ConfinedSpace | null) ?? null)
    setTests((testResult.data ?? []) as AtmosphericTest[])
    setEntries((entryResult.data ?? []) as ConfinedSpaceEntry[])
    setLoading(false)
  }, [tenant?.id, permitId])

  useEffect(() => { void load() }, [load])

  const thresholds = useMemo(() => effectiveThresholds(permit, space), [permit, space])

  if (loading) return <Centered><ActivityIndicator /></Centered>
  if (!permit) return <Centered><Text style={formStyles.empty}>{error ?? 'Permit not found.'}</Text></Centered>

  const state = permitState(permit)
  const countdown = permitCountdown(permit, now)
  const open = state === 'active' || state === 'pending_signature'
  const latest = tests[0] ? evaluateTest(tests[0], thresholds) : null

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <ErrorBanner message={error} />
        <Text style={formStyles.mono}>{permit.serial}</Text>
        <Text style={{ fontSize: 18, fontWeight: '700' }}>{space?.description ?? permit.space_id}</Text>
        <Text>{permit.purpose}</Text>

        <View style={formStyles.card}>
          <Text style={[styles.stateLabel, { color: state === 'active' ? '#047857' : '#b91c1c' }]}>
            {state === 'pending_signature' ? 'Awaiting supervisor signature'
              : state === 'active' ? `Active · ${countdown.label} remaining`
              : state === 'expired' ? 'Expired: evacuate and verify the space is clear'
              : 'Canceled'}
          </Text>
          <Text style={formStyles.rowMeta}>Expires {formatShortDateTime(permit.expires_at)}</Text>
          {latest ? (
            <Text style={[styles.stateLabel, { color: STATUS_COLOR[latest.status] }]}>
              Last reading: {latest.status === 'unknown' ? 'incomplete' : latest.status}
            </Text>
          ) : (
            <Text style={formStyles.rowMeta}>No atmospheric readings yet.</Text>
          )}
        </View>

        {open ? (
          <TestForm
            permitId={permit.id}
            userId={userId}
            thresholds={thresholds}
            onSaved={test => setTests(prev => [test, ...prev])}
          />
        ) : null}

        <Text style={styles.section}>Readings</Text>
        {tests.length === 0 ? <Text style={formStyles.rowMeta}>None recorded.</Text> : tests.map(test => {
          const result = evaluateTest(test, thresholds)
          return (
            <View key={test.id} style={formStyles.card}>
              <Text style={[styles.stateLabel, { color: STATUS_COLOR[result.status] }]}>
                {KIND_LABEL[test.kind]} · {result.status === 'unknown' ? 'incomplete' : result.status}
              </Text>
              <Text style={formStyles.rowMeta}>
                O₂ {test.o2_pct ?? '—'}% · LEL {test.lel_pct ?? '—'}% · H₂S {test.h2s_ppm ?? '—'} ppm · CO {test.co_ppm ?? '—'} ppm
              </Text>
              <Text style={formStyles.rowMeta}>{formatShortDateTime(test.tested_at)}</Text>
            </View>
          )
        })}

        <Text style={styles.section}>Entrants</Text>
        <EntrantLog
          permit={permit}
          entries={entries}
          userId={userId}
          canRecord={state === 'active'}
          onChanged={row => setEntries(prev => [row, ...prev.filter(e => e.id !== row.id)])}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

function TestForm({ permitId, userId, thresholds, onSaved }: {
  permitId: string
  userId: string | null
  thresholds: ReturnType<typeof effectiveThresholds>
  onSaved: (test: AtmosphericTest) => void
}) {
  const [kind, setKind] = useState<AtmosphericTestKind>('pre_entry')
  const [values, setValues] = useState<Record<ChannelKey, string>>({ o2: '', lel: '', h2s: '', co: '' })
  const [instrument, setInstrument] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    if (!userId) { setError('Sign in first.'); return }
    const o2 = parseReading(values.o2)
    const lel = parseReading(values.lel)
    if (o2 === null && lel === null) {
      setError('Record at least O₂ and LEL: both are mandatory channels under §1910.146(d)(5).')
      return
    }
    setBusy(true); setError(null)
    const { data, error: insertError } = await supabase
      .from('loto_atmospheric_tests')
      .insert({
        permit_id:     permitId,
        tested_by:     userId,
        o2_pct:        o2,
        lel_pct:       lel,
        h2s_ppm:       parseReading(values.h2s),
        co_ppm:        parseReading(values.co),
        instrument_id: instrument.trim() || null,
        kind,
        notes:         notes.trim() || null,
      })
      .select('*')
      .single()
    setBusy(false)
    if (insertError || !data) { setError(insertError?.message ?? 'Could not record the reading.'); return }
    onSaved(data as AtmosphericTest)
    setValues({ o2: '', lel: '', h2s: '', co: '' }); setInstrument(''); setNotes('')
  }

  return (
    <View style={formStyles.card}>
      <Text style={styles.section}>Record a reading</Text>
      <ErrorBanner message={error} />
      <Field label="Type"><ChipSelect options={TEST_KINDS} value={kind} onChange={setKind} labelFor={k => KIND_LABEL[k]} /></Field>
      <View style={styles.channelGrid}>
        {CHANNELS.map(channel => {
          const status = evaluateChannel(channel.key, parseReading(values[channel.key]), thresholds)
          return (
            <View key={channel.key} style={styles.channel}>
              <Text style={[styles.channelLabel, { color: STATUS_COLOR[status] }]}>{channel.label} ({channel.unit})</Text>
              <TextInput
                value={values[channel.key]}
                onChangeText={text => setValues(prev => ({ ...prev, [channel.key]: text }))}
                keyboardType="decimal-pad"
                style={[formStyles.input, { borderColor: STATUS_COLOR[status] }]}
                accessibilityLabel={`${channel.label} reading`}
              />
            </View>
          )
        })}
      </View>
      <Text style={formStyles.rowMeta}>
        Limits: O₂ {thresholds.o2_min}–{thresholds.o2_max}% · LEL ≤{thresholds.lel_max}% · H₂S ≤{thresholds.h2s_max} ppm · CO ≤{thresholds.co_max} ppm
      </Text>
      <TextInput value={instrument} onChangeText={setInstrument} placeholder="Meter ID (optional)" placeholderTextColor="#94a3b8" style={formStyles.input} />
      <TextInput value={notes} onChangeText={setNotes} placeholder="Notes (optional)" placeholderTextColor="#94a3b8" style={formStyles.input} />
      <PrimaryButton label="Save reading" onPress={onSubmit} busy={busy} />
    </View>
  )
}

function EntrantLog({ permit, entries, userId, canRecord, onChanged }: {
  permit: ConfinedSpacePermit
  entries: ConfinedSpaceEntry[]
  userId: string | null
  canRecord: boolean
  onChanged: (row: ConfinedSpaceEntry) => void
}) {
  const [busyName, setBusyName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A name on an open entry that isn't on the roster still needs a way out,
  // so the list is the roster plus anyone currently inside.
  const insideNames = entries.filter(e => e.exited_at === null).map(e => e.entrant_name)
  const names = [...new Set([...permit.entrants, ...insideNames])]

  async function enter(name: string) {
    if (!userId) { setError('Sign in first.'); return }
    setBusyName(name); setError(null)
    const { data, error: insertError } = await supabase
      .from('loto_confined_space_entries')
      .insert({ permit_id: permit.id, entrant_name: name, entered_by: userId })
      .select('*').single()
    setBusyName(null)
    if (insertError || !data) { setError(insertError?.message ?? 'Could not record entry.'); return }
    onChanged(data as ConfinedSpaceEntry)
  }

  async function exit(entry: ConfinedSpaceEntry) {
    if (!userId) { setError('Sign in first.'); return }
    setBusyName(entry.entrant_name); setError(null)
    const { data, error: updateError } = await supabase
      .from('loto_confined_space_entries')
      .update({ exited_at: new Date().toISOString(), exited_by: userId })
      .eq('id', entry.id).select('*').single()
    setBusyName(null)
    if (updateError || !data) { setError(updateError?.message ?? 'Could not record exit.'); return }
    onChanged(data as ConfinedSpaceEntry)
  }

  function confirmEnter(name: string) {
    Alert.alert(`Log ${name} IN?`, 'Confirm the latest atmospheric reading is acceptable and the attendant is in position.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log in', onPress: () => { void enter(name) } },
    ])
  }

  if (names.length === 0) return <Text style={formStyles.rowMeta}>No entrants are listed on this permit.</Text>

  return (
    <View style={{ gap: 8 }}>
      <ErrorBanner message={error} />
      {names.map(name => {
        const open = entries.find(e => e.entrant_name === name && e.exited_at === null)
        return (
          <View key={name} style={[formStyles.card, open && styles.inside]}>
            <Text style={formStyles.rowTitle}>{name}</Text>
            <Text style={formStyles.rowMeta}>{open ? `Inside since ${formatShortDateTime(open.entered_at)}` : 'Outside'}</Text>
            {open ? (
              <PrimaryButton label="Log OUT" onPress={() => { void exit(open) }} busy={busyName === name} />
            ) : canRecord ? (
              <PrimaryButton label="Log IN" onPress={() => confirmEnter(name)} busy={busyName === name} />
            ) : null}
          </View>
        )
      })}
      {!canRecord ? <Text style={formStyles.rowMeta}>Entry can be logged only while the permit is signed and active.</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  section: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  stateLabel: { fontSize: 14, fontWeight: '700' },
  channelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  channel: { width: '47%', gap: 4 },
  channelLabel: { fontSize: 12, fontWeight: '700' },
  inside: { borderColor: '#6EE7B7', backgroundColor: 'rgba(16, 185, 129, 0.08)' },
})
