import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  loadAllDevices,
  loadAllWorkers,
  loadOpenCheckouts,
  type OpenCheckoutRow,
} from '@soteria/core/queries/lotoDevices'
import {
  evaluateLotoTraining,
  lotoTrainingStatusText,
  lotoTrainingStatusTone,
  type LotoTrainingStatus,
  type LotoTrainingTone,
} from '@soteria/core/trainingRecords'
import type { LotoDevice, LotoWorker, TrainingRecord } from '@soteria/core/types'

// Mobile parity for /admin/loto-devices.
//
// Uses the shared @soteria/core query layer so the data shape + RLS
// scoping match the web app. Switching tenants on the mobile
// dashboard re-keys this screen via tenantId.
//
// The check-out modal has the same training gate as the web flow:
// missing or expired LOTO §1910.147 cert disables the Check-out
// button. Adding a brand-new worker on mobile is intentionally
// limited to the shop-floor path (no email invite) — the email
// invite flow lives behind /api/admin/users which is web-orchestrated.

interface ProfileLite { id: string; email: string | null; full_name: string | null }

export default function LotoDevicesScreen() {
  const { tenantId } = useTenant()
  const { profile } = useAuth()

  const [devices,        setDevices]        = useState<LotoDevice[] | null>(null)
  const [openCheckouts,  setOpenCheckouts]  = useState<OpenCheckoutRow[] | null>(null)
  const [profiles,       setProfiles]       = useState<ProfileLite[]>([])
  const [workers,        setWorkers]        = useState<LotoWorker[]>([])
  const [trainingByName, setTrainingByName] = useState<Map<string, TrainingRecord[]>>(new Map())

  const [error,      setError]      = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [query,      setQuery]      = useState('')

  const [checkoutFor, setCheckoutFor] = useState<LotoDevice | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    else                    setRefreshing(true)
    setError(null)
    try {
      const [d, o, allWorkers, profsRes, trainingsRes] = await Promise.all([
        loadAllDevices(),
        loadOpenCheckouts(),
        loadAllWorkers().catch(() => [] as LotoWorker[]),
        supabase.from('profiles').select('id, email, full_name').order('full_name', { ascending: true }),
        supabase.from('loto_training_records').select('*').eq('role', 'authorized_employee'),
      ])
      setDevices(d)
      setOpenCheckouts(o)
      setWorkers(allWorkers)
      setProfiles((profsRes.data ?? []) as ProfileLite[])

      const map = new Map<string, TrainingRecord[]>()
      for (const t of (trainingsRes.data ?? []) as TrainingRecord[]) {
        const k = t.worker_name.trim().toLowerCase()
        const list = map.get(k) ?? []
        list.push(t)
        map.set(k, list)
      }
      setTrainingByName(map)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!tenantId) return
    void load('initial')
  }, [tenantId, load])

  const profileById = useMemo(() => {
    const m = new Map<string, ProfileLite>()
    for (const p of profiles) m.set(p.id, p)
    return m
  }, [profiles])

  const workerById = useMemo(() => {
    const m = new Map<string, LotoWorker>()
    for (const w of workers) m.set(w.id, w)
    return m
  }, [workers])

  const openByDeviceId = useMemo(() => {
    const m = new Map<string, OpenCheckoutRow>()
    for (const r of openCheckouts ?? []) m.set(r.checkout.device_id, r)
    return m
  }, [openCheckouts])

  const filtered = useMemo(() => {
    if (!devices) return []
    const q = query.trim().toLowerCase()
    if (!q) return devices
    return devices.filter(d =>
      d.device_label.toLowerCase().includes(q) ||
      (d.description ?? '').toLowerCase().includes(q),
    )
  }, [devices, query])

  function ownerLabel(checkout: { owner_id: string | null; worker_id: string | null }): string {
    if (checkout.worker_id) {
      const w = workerById.get(checkout.worker_id)
      return w?.full_name ?? 'worker'
    }
    if (checkout.owner_id) {
      const p = profileById.get(checkout.owner_id)
      return p?.full_name ?? p?.email ?? 'app user'
    }
    return '—'
  }

  async function returnDevice(d: LotoDevice) {
    if (!profile?.id) return
    const open = openByDeviceId.get(d.id)
    if (!open) {
      Alert.alert('Not checked out', 'No open checkout found.')
      await load('refresh')
      return
    }
    Alert.alert(
      `Return ${d.device_label}?`,
      'This closes the open checkout.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text:    'Return',
          style:   'destructive',
          onPress: async () => {
            const nowIso = new Date().toISOString()
            const { error: chkErr } = await supabase
              .from('loto_device_checkouts')
              .update({ returned_at: nowIso, returned_by: profile.id })
              .eq('id', open.checkout.id)
            if (chkErr) { Alert.alert('Error', chkErr.message); return }
            const { error: devErr } = await supabase
              .from('loto_devices')
              .update({ status: 'available', current_checkout_id: null })
              .eq('id', d.id)
            if (devErr) { Alert.alert('Error', devErr.message); return }
            await load('refresh')
          },
        },
      ],
    )
  }

  if (!tenantId) {
    return <View style={styles.center}><Text style={styles.muted}>No tenant selected. Open the dashboard to pick one.</Text></View>
  }
  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" /></View>
  }
  if (error) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Couldn’t load devices</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable onPress={() => void load('initial')} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchRow}>
        <TextInput
          style={styles.search}
          placeholder="Search by label or description"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.muted}>{query ? 'No devices match.' : 'No devices yet.'}</Text>
          </View>
        }
        ListHeaderComponent={
          filtered.length > 0
            ? <Text style={styles.countLabel}>{filtered.length} device{filtered.length === 1 ? '' : 's'}</Text>
            : null
        }
        renderItem={({ item }) => {
          const open = openByDeviceId.get(item.id)
          return (
            <DeviceRow
              device={item}
              holderLabel={open ? ownerLabel(open.checkout) : null}
              equipmentId={open?.checkout.equipment_id ?? null}
              onCheckOut={() => setCheckoutFor(item)}
              onReturn={() => void returnDevice(item)}
            />
          )
        }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} />}
        contentContainerStyle={filtered.length === 0 ? styles.flexFill : undefined}
      />

      {checkoutFor && (
        <CheckoutModal
          device={checkoutFor}
          profiles={profiles}
          workers={workers}
          trainingByName={trainingByName}
          tenantId={tenantId}
          recordedBy={profile?.id ?? null}
          onClose={() => setCheckoutFor(null)}
          onCheckedOut={() => { setCheckoutFor(null); void load('refresh') }}
        />
      )}
    </View>
  )
}

// ── Device row ───────────────────────────────────────────────────────────
function DeviceRow({
  device, holderLabel, equipmentId, onCheckOut, onReturn,
}: {
  device:       LotoDevice
  holderLabel:  string | null
  equipmentId:  string | null
  onCheckOut:   () => void
  onReturn:     () => void
}) {
  const isAvailable = device.status === 'available'
  const isCheckedOut = device.status === 'checked_out'
  return (
    <View style={styles.row}>
      <View style={[styles.statusDot, statusDotStyle(device.status)]} />
      <View style={styles.rowBody}>
        <Text style={styles.rowId}>{device.device_label}</Text>
        {device.description && <Text style={styles.rowDesc} numberOfLines={1}>{device.description}</Text>}
        <Text style={styles.rowMeta}>
          {device.status.replace('_', ' ')}
          {holderLabel && ` · ${holderLabel}`}
          {equipmentId && ` · ${equipmentId}`}
        </Text>
      </View>
      {isAvailable && (
        <Pressable onPress={onCheckOut} style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>Check out</Text>
        </Pressable>
      )}
      {isCheckedOut && (
        <Pressable onPress={onReturn} style={[styles.actionBtn, styles.actionBtnReturn]}>
          <Text style={styles.actionBtnTextReturn}>Return</Text>
        </Pressable>
      )}
    </View>
  )
}

function statusDotStyle(status: LotoDevice['status']) {
  switch (status) {
    case 'available':   return { backgroundColor: '#10b981' }
    case 'checked_out': return { backgroundColor: '#f59e0b' }
    case 'maintenance': return { backgroundColor: '#94a3b8' }
    case 'lost':        return { backgroundColor: '#ef4444' }
  }
}

// ── Check-out modal ──────────────────────────────────────────────────────
type OwnerKind = 'profile' | 'worker'

function CheckoutModal({
  device, profiles, workers, trainingByName, tenantId, recordedBy,
  onClose, onCheckedOut,
}: {
  device:         LotoDevice
  profiles:       ProfileLite[]
  workers:        LotoWorker[]
  trainingByName: Map<string, TrainingRecord[]>
  tenantId:       string
  recordedBy:     string | null
  onClose:        () => void
  onCheckedOut:   () => void
}) {
  const [ownerKind, setOwnerKind] = useState<OwnerKind | null>(null)
  const [ownerId,   setOwnerId]   = useState<string>('')
  const [equipmentId, setEquipmentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Add-worker form. Mobile path is shop-floor only — no email invite.
  // Email-based invites need server-side /api/admin/users which lives
  // on the web app.
  const [addOpen,           setAddOpen]           = useState(false)
  const [addName,           setAddName]           = useState('')
  const [addEmployeeId,     setAddEmployeeId]     = useState('')
  const [trainingCompleted, setTrainingCompleted] = useState('')
  const [trainingExpires,   setTrainingExpires]   = useState('')
  const [trainingAuthority, setTrainingAuthority] = useState('')
  const [addBusy,           setAddBusy]           = useState(false)
  const [addError,          setAddError]          = useState<string | null>(null)
  const [localWorkers,      setLocalWorkers]      = useState<LotoWorker[]>(workers)
  const [localTraining,     setLocalTraining]     = useState<Map<string, TrainingRecord[]>>(trainingByName)

  useEffect(() => { setLocalWorkers(workers) }, [workers])
  useEffect(() => { setLocalTraining(trainingByName) }, [trainingByName])

  const selectedOwnerName = useMemo(() => {
    if (!ownerKind || !ownerId) return ''
    if (ownerKind === 'profile') {
      const p = profiles.find(p => p.id === ownerId)
      return p?.full_name ?? p?.email ?? ''
    }
    const w = localWorkers.find(w => w.id === ownerId)
    return w?.full_name ?? ''
  }, [ownerKind, ownerId, profiles, localWorkers])

  const trainingStatus: LotoTrainingStatus | null = useMemo(() => {
    if (!ownerKind || !selectedOwnerName) return null
    return evaluateLotoTraining({
      workerName: selectedOwnerName,
      records:    localTraining.get(selectedOwnerName.trim().toLowerCase()) ?? [],
      asOf:       new Date(),
    })
  }, [ownerKind, selectedOwnerName, localTraining])

  const trainingBlocks = trainingStatus?.status === 'missing' || trainingStatus?.status === 'expired'

  async function submit() {
    if (!ownerKind || !ownerId)  { setError('Pick a worker.');      return }
    if (!recordedBy)              { setError('Sign-in expired.');    return }
    if (trainingBlocks)           { setError('LOTO training is missing or expired. Add or renew first.'); return }
    setBusy(true); setError(null)

    const insertPayload: Record<string, unknown> = {
      device_id:    device.id,
      equipment_id: equipmentId.trim() || null,
      recorded_by:  recordedBy,
    }
    if (ownerKind === 'profile') insertPayload.owner_id  = ownerId
    else                         insertPayload.worker_id = ownerId

    const { data: row, error: insErr } = await supabase
      .from('loto_device_checkouts').insert(insertPayload).select('id').single()
    if (insErr || !row) {
      setBusy(false)
      if (insErr?.message?.includes('idx_device_checkouts_one_open')) {
        setError('Already checked out. Return it first.')
      } else {
        setError(insErr?.message ?? 'Could not record checkout.')
      }
      return
    }
    const { error: updErr } = await supabase
      .from('loto_devices').update({ status: 'checked_out', current_checkout_id: row.id }).eq('id', device.id)
    setBusy(false)
    if (updErr) { setError(updErr.message); return }
    onCheckedOut()
  }

  async function onAddSubmit() {
    if (addBusy) return
    const fullName = addName.trim()
    const completedAt = trainingCompleted.trim()
    if (!fullName)                                       { setAddError('Full name is required.'); return }
    if (!completedAt || !/^\d{4}-\d{2}-\d{2}$/.test(completedAt)) {
      setAddError('LOTO training completion date is required (YYYY-MM-DD).')
      return
    }
    if (trainingExpires && trainingExpires < completedAt) {
      setAddError('Training expiry cannot be before completion date.')
      return
    }
    setAddBusy(true); setAddError(null)
    try {
      const { data: created, error: wErr } = await supabase
        .from('loto_workers')
        .insert({
          tenant_id:    tenantId,
          full_name:    fullName,
          employee_id:  addEmployeeId.trim() || null,
          created_by:   recordedBy,
        })
        .select('*').single()
      if (wErr || !created) {
        if (wErr?.message?.includes('idx_loto_workers_employee_id')) {
          setAddError(`Employee ID "${addEmployeeId.trim()}" already exists.`)
        } else {
          setAddError(wErr?.message ?? 'Could not add worker.')
        }
        return
      }

      // Insert training record, best-effort.
      const { error: trainErr } = await supabase
        .from('loto_training_records')
        .insert({
          worker_name:    fullName,
          role:           'authorized_employee',
          completed_at:   completedAt,
          expires_at:     trainingExpires.trim() || null,
          cert_authority: trainingAuthority.trim() || null,
          notes:          'Self-enrolled at LOTO checkout (mobile)',
        })

      // Update local state so the picker + training gate update immediately.
      const newWorker = created as LotoWorker
      setLocalWorkers(prev => [...prev, newWorker].sort((a, b) => a.full_name.localeCompare(b.full_name)))
      const newRecords = new Map(localTraining)
      if (!trainErr) {
        const k = fullName.trim().toLowerCase()
        const list = newRecords.get(k) ?? []
        list.push({
          id:             'tmp',
          worker_name:    fullName,
          role:           'authorized_employee',
          completed_at:   completedAt,
          expires_at:     trainingExpires.trim() || null,
          cert_authority: trainingAuthority.trim() || null,
          notes:          null,
          created_by:     null,
          created_at:     new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        })
        newRecords.set(k, list)
        setLocalTraining(newRecords)
      }
      setOwnerKind('worker')
      setOwnerId(newWorker.id)
      setAddOpen(false)
      setAddName(''); setAddEmployeeId(''); setTrainingCompleted(''); setTrainingExpires(''); setTrainingAuthority('')
      if (trainErr) setError(`Worker added but training record failed: ${trainErr.message}`)
    } finally {
      setAddBusy(false)
    }
  }

  return (
    <Modal animationType="slide" transparent={true} onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Check out {device.device_label}</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.modalClose}>✕</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.fieldLabel}>OWNER</Text>

            {/* Workers list */}
            {localWorkers.length > 0 && (
              <>
                <Text style={styles.groupLabel}>Workers</Text>
                {localWorkers.map(w => (
                  <Pressable
                    key={w.id}
                    onPress={() => { setOwnerKind('worker'); setOwnerId(w.id) }}
                    style={[
                      styles.pickerRow,
                      ownerKind === 'worker' && ownerId === w.id && styles.pickerRowSelected,
                    ]}
                  >
                    <Text style={styles.pickerName}>
                      {w.full_name}{w.employee_id ? ` · ${w.employee_id}` : ''}
                    </Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* Profiles (app users) */}
            {profiles.length > 0 && (
              <>
                <Text style={styles.groupLabel}>App users</Text>
                {profiles.map(p => (
                  <Pressable
                    key={p.id}
                    onPress={() => { setOwnerKind('profile'); setOwnerId(p.id) }}
                    style={[
                      styles.pickerRow,
                      ownerKind === 'profile' && ownerId === p.id && styles.pickerRowSelected,
                    ]}
                  >
                    <Text style={styles.pickerName}>{p.full_name || p.email || p.id.slice(0, 8)}</Text>
                  </Pressable>
                ))}
              </>
            )}

            {/* Add new worker toggle */}
            {!addOpen && (
              <Pressable onPress={() => setAddOpen(true)} style={styles.addRow}>
                <Text style={styles.addRowText}>+ Add new worker</Text>
              </Pressable>
            )}

            {addOpen && (
              <View style={styles.addPanel}>
                <Text style={styles.addPanelTitle}>Add new worker (shop-floor)</Text>
                <Text style={styles.addPanelHint}>
                  No app login. Email invites for app users live on the web admin page.
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="Full name *"
                  value={addName}
                  onChangeText={setAddName}
                  editable={!addBusy}
                  autoCorrect={false}
                />
                <TextInput
                  style={[styles.input, styles.inputMono]}
                  placeholder="Employee ID (optional)"
                  value={addEmployeeId}
                  onChangeText={setAddEmployeeId}
                  editable={!addBusy}
                  autoCorrect={false}
                  autoCapitalize="characters"
                />
                <Text style={styles.subFieldLabel}>LOTO training (29 CFR 1910.147)</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Completed on (YYYY-MM-DD) *"
                  value={trainingCompleted}
                  onChangeText={setTrainingCompleted}
                  editable={!addBusy}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Expires (YYYY-MM-DD, optional)"
                  value={trainingExpires}
                  onChangeText={setTrainingExpires}
                  editable={!addBusy}
                  autoCorrect={false}
                  autoCapitalize="none"
                />
                <TextInput
                  style={styles.input}
                  placeholder="Issued by (e.g. Plant Safety)"
                  value={trainingAuthority}
                  onChangeText={setTrainingAuthority}
                  editable={!addBusy}
                  autoCorrect={false}
                />
                {addError && <Text style={styles.errorBody}>{addError}</Text>}
                <View style={styles.btnRow}>
                  <Pressable onPress={() => { setAddOpen(false); setAddError(null) }} disabled={addBusy} style={styles.btnSecondary}>
                    <Text style={styles.btnSecondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={onAddSubmit} disabled={addBusy} style={[styles.btnPrimary, addBusy && styles.btnDisabled]}>
                    <Text style={styles.btnPrimaryText}>{addBusy ? 'Saving…' : 'Add & select'}</Text>
                  </Pressable>
                </View>
              </View>
            )}

            {trainingStatus && <TrainingBadge status={trainingStatus} workerName={selectedOwnerName} />}

            <Text style={styles.fieldLabel}>EQUIPMENT / AREA</Text>
            <TextInput
              style={styles.input}
              placeholder="EQ-014 or descriptive bay/circuit (optional)"
              value={equipmentId}
              onChangeText={setEquipmentId}
              editable={!busy}
              autoCorrect={false}
            />

            {error && <Text style={styles.errorBody}>{error}</Text>}
          </ScrollView>

          <View style={styles.modalFooter}>
            <Pressable onPress={onClose} style={styles.btnSecondary} disabled={busy}>
              <Text style={styles.btnSecondaryText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={busy || !ownerKind || !ownerId || trainingBlocks}
              style={[styles.btnPrimary, (busy || !ownerKind || !ownerId || trainingBlocks) && styles.btnDisabled]}
            >
              <Text style={styles.btnPrimaryText}>{busy ? 'Saving…' : 'Check out'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

// RN tone palette mirrors the web (CheckoutDialog) — different
// styling system, same 3-bucket meaning so a future color tweak
// only needs to land in one place if we centralise the palette.
const TONE_COLORS: Record<LotoTrainingTone, { bg: string; fg: string }> = {
  success: { bg: '#d1fae5', fg: '#065f46' },
  warn:    { bg: '#fef3c7', fg: '#92400e' },
  danger:  { bg: '#fee2e2', fg: '#991b1b' },
}

function TrainingBadge({ status, workerName }: { status: LotoTrainingStatus; workerName: string }) {
  const { bg, fg } = TONE_COLORS[lotoTrainingStatusTone(status)]
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.badgeText, { color: fg }]}>
        {lotoTrainingStatusText(status, workerName)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container:        { flex: 1 },
  center:           { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16, gap: 8 },
  flexFill:         { flexGrow: 1 },
  muted:            { fontSize: 14, opacity: 0.6, textAlign: 'center' },
  errorText:        { fontSize: 16, fontWeight: '600' },
  errorBody:        { fontSize: 12, color: '#b91c1c', backgroundColor: '#fee2e2', padding: 8, borderRadius: 6, marginTop: 8 },
  retryBtn:         { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#94a3b8' },
  retryText:        { fontSize: 14, fontWeight: '600' },
  searchRow:        { padding: 12 },
  search:           { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  countLabel:       { fontSize: 11, opacity: 0.5, paddingHorizontal: 12, paddingVertical: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  row:              { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },
  statusDot:        { width: 10, height: 10, borderRadius: 5 },
  rowBody:          { flex: 1, gap: 1 },
  rowId:            { fontSize: 14, fontWeight: '600', fontFamily: 'Menlo' },
  rowDesc:          { fontSize: 12, opacity: 0.7 },
  rowMeta:          { fontSize: 11, opacity: 0.5, marginTop: 1 },
  actionBtn:        { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#fef3c7', borderWidth: 1, borderColor: '#fcd34d' },
  actionBtnText:    { fontSize: 12, fontWeight: '700', color: '#78350f' },
  actionBtnReturn:  { backgroundColor: '#10b981', borderColor: '#10b981' },
  actionBtnTextReturn: { fontSize: 12, fontWeight: '700', color: 'white' },

  modalBackdrop:    { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalCard:        { backgroundColor: 'white', borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '90%' },
  modalHeader:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1' },
  modalTitle:       { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  modalClose:       { fontSize: 18, color: '#94a3b8' },
  modalBody:        { padding: 16, paddingBottom: 8, gap: 8 },
  modalFooter:      { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#cbd5e1' },

  fieldLabel:       { fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.5, marginTop: 8 },
  subFieldLabel:    { fontSize: 11, fontWeight: '600', color: '#64748b', letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  groupLabel:       { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 8, marginBottom: 4 },

  pickerRow:        { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#cbd5e1', marginBottom: 4 },
  pickerRowSelected:{ borderColor: '#1e3a8a', backgroundColor: '#eef2ff' },
  pickerName:       { fontSize: 14, color: '#0f172a' },
  addRow:           { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center', marginTop: 8 },
  addRowText:       { fontSize: 13, color: '#1e3a8a', fontWeight: '600' },
  addPanel:         { padding: 12, borderRadius: 8, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#cbd5e1', marginTop: 8, gap: 6 },
  addPanelTitle:    { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  addPanelHint:     { fontSize: 11, color: '#64748b' },

  input:            { borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: 'white' },
  inputMono:        { fontFamily: 'Menlo' },

  badge:            { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, marginTop: 6 },
  badgeText:        { fontSize: 12, fontWeight: '500' },

  btnRow:           { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  btnPrimary:       { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1e3a8a' },
  btnPrimaryText:   { fontSize: 14, fontWeight: '600', color: 'white' },
  btnSecondary:     { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  btnSecondaryText: { fontSize: 14, color: '#475569' },
  btnDisabled:      { opacity: 0.4 },
})
