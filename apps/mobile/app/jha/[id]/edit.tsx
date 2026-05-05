import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native'

import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  JHA_HAZARD_CATEGORIES,
  JHA_SEVERITY_BANDS,
  countPpeAloneWarnings,
  type JhaHazardCategory,
  type JhaSeverity,
  type JhaRow,
  type JhaStep,
  type JhaHazard,
  type JhaHazardControl,
} from '@soteria/core/jha'
import { HIERARCHY_ORDER, HIERARCHY_LABELS, type HierarchyLevel } from '@soteria/core/risk'

// /jha/[id]/edit (mobile) — Full breakdown editor. iPad-class
// target so we ship feature parity with web /jha/[id]/edit, not a
// stripped-down version. Same in-memory tree + local_id pattern;
// Save POSTs the whole tree to PUT /api/jha/[id]/breakdown.

interface ControlsLibraryEntry {
  id:                    string
  hierarchy_level:       HierarchyLevel
  name:                  string
  applicable_categories: string[]
}

interface DraftStep    { local_id: string; sequence: number; description: string; notes: string | null }
interface DraftHazard  { local_id: string; step_local_id: string | null; hazard_category: JhaHazardCategory; description: string; potential_severity: JhaSeverity; notes: string | null }
interface DraftControl { local_id: string; hazard_local_id: string; control_id: string | null; custom_name: string | null; hierarchy_level: HierarchyLevel; notes: string | null }

let nextId = 1
const localId = (prefix: string) => `${prefix}-${nextId++}-${Math.random().toString(36).slice(2, 7)}`

export default function JhaEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { tenant } = useTenant()

  const [jha,      setJha]      = useState<JhaRow | null>(null)
  const [steps,    setSteps]    = useState<DraftStep[]>([])
  const [hazards,  setHazards]  = useState<DraftHazard[]>([])
  const [controls, setControls] = useState<DraftControl[]>([])
  const [library,  setLibrary]  = useState<ControlsLibraryEntry[]>([])

  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  // ─── Hydrate from the DB bundle ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    if (!tenant?.id || !id) return
    async function load() {
      try {
        const [jhaRes, stepsRes, hazardsRes, controlsRes, libRes] = await Promise.all([
          supabase.from('jhas').select('*').eq('id', id).eq('tenant_id', tenant!.id).maybeSingle(),
          supabase.from('jha_steps').select('*').eq('jha_id', id).eq('tenant_id', tenant!.id).order('sequence', { ascending: true }),
          supabase.from('jha_hazards').select('*').eq('jha_id', id).eq('tenant_id', tenant!.id),
          supabase.from('jha_hazard_controls').select('*').eq('jha_id', id).eq('tenant_id', tenant!.id),
          supabase.from('controls_library').select('id, hierarchy_level, name, applicable_categories').eq('tenant_id', tenant!.id).eq('active', true).order('name'),
        ])
        if (cancelled) return
        const err = jhaRes.error || stepsRes.error || hazardsRes.error || controlsRes.error || libRes.error
        if (err) throw new Error(err.message)
        if (!jhaRes.data) throw new Error('JHA not found')

        setJha(jhaRes.data as JhaRow)
        setLibrary((libRes.data ?? []) as ControlsLibraryEntry[])

        const stepIdMap = new Map<string, string>()
        const dbSteps   = (stepsRes.data    ?? []) as JhaStep[]
        const dbHazards = (hazardsRes.data  ?? []) as JhaHazard[]
        const dbCtrls   = (controlsRes.data ?? []) as JhaHazardControl[]

        setSteps(dbSteps.map(s => {
          const lid = localId('s')
          stepIdMap.set(s.id, lid)
          return { local_id: lid, sequence: s.sequence, description: s.description, notes: s.notes }
        }))

        const hazardIdMap = new Map<string, string>()
        setHazards(dbHazards.map(h => {
          const lid = localId('h')
          hazardIdMap.set(h.id, lid)
          return {
            local_id:           lid,
            step_local_id:      h.step_id ? stepIdMap.get(h.step_id) ?? null : null,
            hazard_category:    h.hazard_category,
            description:        h.description,
            potential_severity: h.potential_severity,
            notes:              h.notes,
          }
        }))

        setControls(dbCtrls.map(c => ({
          local_id:        localId('c'),
          hazard_local_id: hazardIdMap.get(c.hazard_id) ?? '',
          control_id:      c.control_id,
          custom_name:     c.custom_name,
          hierarchy_level: c.hierarchy_level,
          notes:           c.notes,
        })).filter(c => c.hazard_local_id !== ''))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [tenant?.id, id])

  // ─── Mutators ───────────────────────────────────────────────────────────
  const addStep = useCallback(() => {
    setSteps(prev => [...prev, { local_id: localId('s'), sequence: prev.length + 1, description: '', notes: null }])
  }, [])

  const updateStep = useCallback((sid: string, patch: Partial<DraftStep>) => {
    setSteps(prev => prev.map(s => s.local_id === sid ? { ...s, ...patch } : s))
  }, [])

  const moveStep = useCallback((sid: string, dir: -1 | 1) => {
    setSteps(prev => {
      const idx = prev.findIndex(s => s.local_id === sid)
      const target = idx + dir
      if (idx < 0 || target < 0 || target >= prev.length) return prev
      const next = prev.slice()
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next.map((s, i) => ({ ...s, sequence: i + 1 }))
    })
  }, [])

  const removeStep = useCallback((sid: string) => {
    setSteps(prev => prev.filter(s => s.local_id !== sid).map((s, i) => ({ ...s, sequence: i + 1 })))
    setHazards(prev => prev.map(h => h.step_local_id === sid ? { ...h, step_local_id: null } : h))
  }, [])

  const addHazard = useCallback((stepLocalId: string | null) => {
    setHazards(prev => [...prev, {
      local_id: localId('h'), step_local_id: stepLocalId, hazard_category: 'physical',
      description: '', potential_severity: 'moderate', notes: null,
    }])
  }, [])

  const updateHazard = useCallback((hid: string, patch: Partial<DraftHazard>) => {
    setHazards(prev => prev.map(h => h.local_id === hid ? { ...h, ...patch } : h))
  }, [])

  const removeHazard = useCallback((hid: string) => {
    setHazards(prev => prev.filter(h => h.local_id !== hid))
    setControls(prev => prev.filter(c => c.hazard_local_id !== hid))
  }, [])

  const addControl = useCallback((hazardLocalId: string) => {
    setControls(prev => [...prev, {
      local_id: localId('c'), hazard_local_id: hazardLocalId, control_id: null,
      custom_name: '', hierarchy_level: 'engineering', notes: null,
    }])
  }, [])

  const updateControl = useCallback((cid: string, patch: Partial<DraftControl>) => {
    setControls(prev => prev.map(c => c.local_id === cid ? { ...c, ...patch } : c))
  }, [])

  const removeControl = useCallback((cid: string) => {
    setControls(prev => prev.filter(c => c.local_id !== cid))
  }, [])

  // ─── PPE-alone warning count ────────────────────────────────────────────
  const ppeWarnings = useMemo(
    () => countPpeAloneWarnings(
      hazards.map(h => ({ ...h, id: h.local_id, jha_id: '', tenant_id: '', step_id: null, created_at: '' })),
      controls.map(c => ({ ...c, id: c.local_id, hazard_id: c.hazard_local_id, jha_id: '', tenant_id: '', created_at: '' })),
    ),
    [hazards, controls],
  )

  // ─── Save ───────────────────────────────────────────────────────────────
  async function onSave() {
    if (!tenant?.id) return
    for (const s of steps) if (!s.description.trim()) { setError('Every step needs a description.'); return }
    for (const h of hazards) if (!h.description.trim()) { setError('Every hazard needs a description.'); return }
    for (const c of controls) if (!c.control_id && !(c.custom_name?.trim())) {
      setError('Every control needs either a library entry or a custom name.'); return
    }

    setSaving(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      // Compute the API base URL from the Supabase URL — same project,
      // different subdomain. Mobile typically runs against a known
      // production / staging origin; Expo Go reads it from app.json.
      const apiBase = process.env.EXPO_PUBLIC_WEB_ORIGIN
        ?? process.env.EXPO_PUBLIC_API_BASE_URL
        ?? ''
      if (!apiBase) {
        throw new Error('EXPO_PUBLIC_WEB_ORIGIN env var not set; cannot reach the breakdown endpoint.')
      }

      const res = await fetch(`${apiBase.replace(/\/$/, '')}/api/jha/${id}/breakdown`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          steps:    steps.map(s => ({ local_id: s.local_id, sequence: s.sequence, description: s.description, notes: s.notes })),
          hazards:  hazards.map(h => ({
            local_id:           h.local_id,
            step_local_id:      h.step_local_id,
            hazard_category:    h.hazard_category,
            description:        h.description,
            potential_severity: h.potential_severity,
            notes:              h.notes,
          })),
          controls: controls.map(c => ({
            hazard_local_id: c.hazard_local_id,
            control_id:      c.control_id,
            custom_name:     c.custom_name,
            hierarchy_level: c.hierarchy_level,
            notes:           c.notes,
          })),
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      router.replace({ pathname: '/jha/[id]', params: { id: id! } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  if (loading) {
    return <View style={styles.center}><ActivityIndicator /></View>
  }

  return (
    <>
      <Stack.Screen options={{
        title: 'Edit breakdown',
        headerRight: () => (
          <Pressable onPress={onSave} disabled={saving}>
            {({ pressed }) => (
              <Text style={[styles.saveBtn, pressed && { opacity: 0.6 }, saving && { opacity: 0.5 }]}>
                {saving ? 'Saving…' : 'Save'}
              </Text>
            )}
          </Pressable>
        ),
      }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.jobNumber}>{jha?.job_number}</Text>
        <Text style={styles.title}>{jha?.title}</Text>

        {error && (
          <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View>
        )}

        {ppeWarnings > 0 && (
          <View style={styles.warnBox}>
            <Text style={styles.warnTitle}>PPE-alone warning</Text>
            <Text style={styles.warnBody}>
              {ppeWarnings} high/extreme {ppeWarnings === 1 ? 'hazard is' : 'hazards are'} covered only by PPE.
              ISO 45001 8.1.2 requires you to consider higher-level controls first. You can save anyway.
            </Text>
          </View>
        )}

        {/* Steps */}
        {steps.map(step => (
          <StepCard
            key={step.local_id}
            step={step}
            hazards={hazards.filter(h => h.step_local_id === step.local_id)}
            controls={controls}
            library={library}
            onUpdate={updateStep}
            onMove={moveStep}
            onRemove={removeStep}
            onAddHazard={() => addHazard(step.local_id)}
            onUpdateHazard={updateHazard}
            onRemoveHazard={removeHazard}
            onAddControl={addControl}
            onUpdateControl={updateControl}
            onRemoveControl={removeControl}
            isFirst={step.sequence === 1}
            isLast={step.sequence === steps.length}
          />
        ))}

        <Pressable onPress={addStep}>
          {({ pressed }) => (
            <View style={[styles.addStepBtn, pressed && { opacity: 0.6 }]}>
              <Text style={styles.addStepText}>+ Add step</Text>
            </View>
          )}
        </Pressable>

        {/* General hazards */}
        <GeneralHazardsCard
          hazards={hazards.filter(h => h.step_local_id === null)}
          controls={controls}
          library={library}
          onAddHazard={() => addHazard(null)}
          onUpdateHazard={updateHazard}
          onRemoveHazard={removeHazard}
          onAddControl={addControl}
          onUpdateControl={updateControl}
          onRemoveControl={removeControl}
        />
      </ScrollView>
    </>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Step card
// ──────────────────────────────────────────────────────────────────────────

interface StepCardProps {
  step:           DraftStep
  hazards:        DraftHazard[]
  controls:       DraftControl[]
  library:        ControlsLibraryEntry[]
  onUpdate:       (sid: string, patch: Partial<DraftStep>) => void
  onMove:         (sid: string, dir: -1 | 1) => void
  onRemove:       (sid: string) => void
  onAddHazard:    () => void
  onUpdateHazard: (hid: string, patch: Partial<DraftHazard>) => void
  onRemoveHazard: (hid: string) => void
  onAddControl:   (hazardLocalId: string) => void
  onUpdateControl: (cid: string, patch: Partial<DraftControl>) => void
  onRemoveControl: (cid: string) => void
  isFirst:        boolean
  isLast:         boolean
}

function StepCard(props: StepCardProps) {
  const { step, hazards, isFirst, isLast } = props
  return (
    <View style={styles.stepCard}>
      <View style={styles.stepHeaderRow}>
        <Text style={styles.stepSeq}>{step.sequence}.</Text>
        <TextInput
          value={step.description}
          onChangeText={t => props.onUpdate(step.local_id, { description: t })}
          placeholder="What does the worker do at this step?"
          placeholderTextColor="#94a3b8"
          style={styles.stepInput}
        />
      </View>
      <View style={styles.stepActionRow}>
        <Pressable onPress={() => props.onMove(step.local_id, -1)} disabled={isFirst}>
          {({ pressed }) => (
            <Text style={[styles.iconBtn, isFirst && { opacity: 0.3 }, pressed && { opacity: 0.5 }]}>↑</Text>
          )}
        </Pressable>
        <Pressable onPress={() => props.onMove(step.local_id, 1)} disabled={isLast}>
          {({ pressed }) => (
            <Text style={[styles.iconBtn, isLast && { opacity: 0.3 }, pressed && { opacity: 0.5 }]}>↓</Text>
          )}
        </Pressable>
        <Pressable onPress={() => props.onRemove(step.local_id)}>
          {({ pressed }) => (
            <Text style={[styles.iconBtn, styles.iconBtnDanger, pressed && { opacity: 0.5 }]}>Remove</Text>
          )}
        </Pressable>
      </View>

      <TextInput
        value={step.notes ?? ''}
        onChangeText={t => props.onUpdate(step.local_id, { notes: t || null })}
        placeholder="Notes (optional)"
        placeholderTextColor="#94a3b8"
        style={styles.stepNotes}
      />

      <HazardList
        hazards={hazards}
        controls={props.controls}
        library={props.library}
        onAddHazard={props.onAddHazard}
        onUpdateHazard={props.onUpdateHazard}
        onRemoveHazard={props.onRemoveHazard}
        onAddControl={props.onAddControl}
        onUpdateControl={props.onUpdateControl}
        onRemoveControl={props.onRemoveControl}
      />
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function GeneralHazardsCard(props: Omit<StepCardProps, 'step' | 'onUpdate' | 'onMove' | 'onRemove' | 'isFirst' | 'isLast'>) {
  if (props.hazards.length === 0) {
    return (
      <Pressable onPress={props.onAddHazard}>
        {({ pressed }) => (
          <View style={[styles.addGeneralBtn, pressed && { opacity: 0.6 }]}>
            <Text style={styles.addGeneralText}>+ Add general (job-wide) hazard</Text>
          </View>
        )}
      </Pressable>
    )
  }
  return (
    <View style={styles.generalCard}>
      <Text style={styles.generalTitle}>General hazards (job-wide)</Text>
      <HazardList {...props} />
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────

function HazardList(props: Pick<StepCardProps, 'hazards' | 'controls' | 'library' | 'onAddHazard' | 'onUpdateHazard' | 'onRemoveHazard' | 'onAddControl' | 'onUpdateControl' | 'onRemoveControl'>) {
  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      {props.hazards.map(h => (
        <HazardRow
          key={h.local_id}
          hazard={h}
          controls={props.controls.filter(c => c.hazard_local_id === h.local_id)}
          library={props.library}
          onUpdate={props.onUpdateHazard}
          onRemove={props.onRemoveHazard}
          onAddControl={() => props.onAddControl(h.local_id)}
          onUpdateControl={props.onUpdateControl}
          onRemoveControl={props.onRemoveControl}
        />
      ))}
      <Pressable onPress={props.onAddHazard}>
        {({ pressed }) => (
          <Text style={[styles.addInlineBtn, pressed && { opacity: 0.5 }]}>+ Add hazard</Text>
        )}
      </Pressable>
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────

interface HazardRowProps {
  hazard:          DraftHazard
  controls:        DraftControl[]
  library:         ControlsLibraryEntry[]
  onUpdate:        (hid: string, patch: Partial<DraftHazard>) => void
  onRemove:        (hid: string) => void
  onAddControl:    () => void
  onUpdateControl: (cid: string, patch: Partial<DraftControl>) => void
  onRemoveControl: (cid: string) => void
}

function HazardRow({ hazard, controls, library, onUpdate, onRemove, onAddControl, onUpdateControl, onRemoveControl }: HazardRowProps) {
  return (
    <View style={styles.hazardCard}>
      <View style={styles.hazardHeaderRow}>
        <TextInput
          value={hazard.description}
          onChangeText={t => onUpdate(hazard.local_id, { description: t })}
          placeholder="What can go wrong?"
          placeholderTextColor="#94a3b8"
          style={styles.hazardInput}
        />
        <Pressable onPress={() => onRemove(hazard.local_id)}>
          {({ pressed }) => (
            <Text style={[styles.iconBtn, styles.iconBtnDanger, pressed && { opacity: 0.5 }]}>×</Text>
          )}
        </Pressable>
      </View>
      <View style={styles.chipRow}>
        <ChipPicker
          label="Category"
          value={hazard.hazard_category}
          options={JHA_HAZARD_CATEGORIES as readonly string[]}
          onChange={v => onUpdate(hazard.local_id, { hazard_category: v as JhaHazardCategory })}
        />
        <ChipPicker
          label="Severity"
          value={hazard.potential_severity}
          options={JHA_SEVERITY_BANDS as readonly string[]}
          onChange={v => onUpdate(hazard.local_id, { potential_severity: v as JhaSeverity })}
        />
      </View>

      <View style={styles.controlsBox}>
        {controls.map(c => (
          <ControlRow
            key={c.local_id}
            control={c}
            library={library}
            hazardCategory={hazard.hazard_category}
            onUpdate={onUpdateControl}
            onRemove={onRemoveControl}
          />
        ))}
        <Pressable onPress={onAddControl}>
          {({ pressed }) => (
            <Text style={[styles.addInlineBtn, pressed && { opacity: 0.5 }]}>+ Add control</Text>
          )}
        </Pressable>
      </View>
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────

interface ControlRowProps {
  control:        DraftControl
  library:        ControlsLibraryEntry[]
  hazardCategory: JhaHazardCategory
  onUpdate:       (cid: string, patch: Partial<DraftControl>) => void
  onRemove:       (cid: string) => void
}

function ControlRow({ control, library, hazardCategory, onUpdate, onRemove }: ControlRowProps) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const filtered = useMemo(() => {
    return library.filter(l => {
      if (!Array.isArray(l.applicable_categories) || l.applicable_categories.length === 0) return true
      return l.applicable_categories.includes(hazardCategory)
    })
  }, [library, hazardCategory])

  const selectedLib = library.find(l => l.id === control.control_id)

  return (
    <View style={styles.controlRow}>
      <ChipPicker
        label="Hierarchy"
        value={control.hierarchy_level}
        options={HIERARCHY_ORDER as readonly string[]}
        labelMap={HIERARCHY_LABELS as Record<string, string>}
        onChange={v => onUpdate(control.local_id, { hierarchy_level: v as HierarchyLevel })}
      />
      <View style={styles.controlPickerRow}>
        <Pressable onPress={() => setPickerOpen(true)} style={{ flex: 1 }}>
          {({ pressed }) => (
            <View style={[styles.libBtn, pressed && { opacity: 0.6 }]}>
              <Text style={styles.libBtnText} numberOfLines={1}>
                {selectedLib?.name ?? '— from library —'}
              </Text>
            </View>
          )}
        </Pressable>
        <TextInput
          value={control.custom_name ?? ''}
          onChangeText={t => onUpdate(control.local_id, { custom_name: t, control_id: t ? null : control.control_id })}
          placeholder="…or custom"
          placeholderTextColor="#94a3b8"
          style={styles.customInput}
        />
        <Pressable onPress={() => onRemove(control.local_id)}>
          {({ pressed }) => (
            <Text style={[styles.iconBtn, styles.iconBtnDanger, pressed && { opacity: 0.5 }]}>×</Text>
          )}
        </Pressable>
      </View>

      <Modal visible={pickerOpen} transparent animationType="fade" onRequestClose={() => setPickerOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerOpen(false)}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Pick from library ({filtered.length})</Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Pressable onPress={() => { onUpdate(control.local_id, { control_id: null }); setPickerOpen(false) }}>
                {({ pressed }) => (
                  <View style={[styles.libRow, pressed && { opacity: 0.6 }]}>
                    <Text style={styles.libRowText}>— Clear library link —</Text>
                  </View>
                )}
              </Pressable>
              {filtered.map(l => (
                <Pressable
                  key={l.id}
                  onPress={() => {
                    onUpdate(control.local_id, { control_id: l.id, custom_name: null, hierarchy_level: l.hierarchy_level })
                    setPickerOpen(false)
                  }}
                >
                  {({ pressed }) => (
                    <View style={[styles.libRow, pressed && { opacity: 0.6 }]}>
                      <Text style={styles.libRowLevel}>{HIERARCHY_LABELS[l.hierarchy_level]}</Text>
                      <Text style={styles.libRowText}>{l.name}</Text>
                    </View>
                  )}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Inline chip picker (used for hazard category, severity, hierarchy level)
// ──────────────────────────────────────────────────────────────────────────

function ChipPicker({ label, value, options, onChange, labelMap }: {
  label:    string
  value:    string
  options:  readonly string[]
  onChange: (v: string) => void
  labelMap?: Record<string, string>
}) {
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <Text style={styles.chipLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {options.map(o => (
          <Pressable key={o} onPress={() => onChange(o)}>
            {({ pressed }) => (
              <View style={[styles.chip, value === o && styles.chipActive, pressed && { opacity: 0.6 }]}>
                <Text style={[styles.chipText, value === o && styles.chipTextActive]}>
                  {labelMap?.[o] ?? o}
                </Text>
              </View>
            )}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

// ──────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  center:        { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  content:       { padding: 16, gap: 12, paddingBottom: 40 },

  saveBtn:       { color: '#1e3a8a', fontSize: 15, fontWeight: '700', paddingHorizontal: 12 },

  jobNumber:     { fontFamily: 'SpaceMono', fontSize: 12, opacity: 0.6 },
  title:         { fontSize: 18, fontWeight: '700', marginBottom: 4 },

  errorBox:      { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEE2E2' },
  errorText:     { color: '#7F1D1D', fontSize: 13 },

  warnBox:       { padding: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FEF3C7' },
  warnTitle:     { fontWeight: '700', color: '#78350f', marginBottom: 4 },
  warnBody:      { color: '#78350f', fontSize: 12 },

  stepCard:      { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', gap: 8 },
  stepHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepSeq:       { fontFamily: 'SpaceMono', fontSize: 14, opacity: 0.6, marginTop: 8 },
  stepInput:     { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, fontWeight: '600' },
  stepActionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 26 },
  stepNotes:     { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, fontSize: 12, opacity: 0.8 },

  iconBtn:       { fontSize: 14, fontWeight: '700', paddingHorizontal: 8, paddingVertical: 4 },
  iconBtnDanger: { color: '#DC2626' },

  generalCard:   { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: 'rgba(254, 243, 199, 0.4)' },
  generalTitle:  { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, color: '#92400e', marginBottom: 6 },

  addStepBtn:    { padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd5e1', alignItems: 'center' },
  addStepText:   { fontSize: 13, fontWeight: '600', color: '#1e3a8a' },

  addGeneralBtn: { padding: 14, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: '#cbd5e1', alignItems: 'center' },
  addGeneralText: { fontSize: 12, fontWeight: '600', color: '#92400e' },

  addInlineBtn:  { fontSize: 12, fontWeight: '600', color: '#1e3a8a', alignSelf: 'flex-start', paddingVertical: 4 },

  hazardCard:    { padding: 10, borderRadius: 8, backgroundColor: 'rgba(148, 163, 184, 0.12)', gap: 8 },
  hazardHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  hazardInput:   { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 13, backgroundColor: '#fff' },

  chipRow:       { flexDirection: 'row', gap: 12 },
  chipLabel:     { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  chip:          { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  chipActive:    { borderColor: '#1e3a8a', backgroundColor: '#1e3a8a' },
  chipText:      { fontSize: 11, textTransform: 'capitalize' },
  chipTextActive: { color: '#fff', fontWeight: '600' },

  controlsBox:   { paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: '#cbd5e1', gap: 8 },
  controlRow:    { gap: 6 },
  controlPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  libBtn:        { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#fff' },
  libBtnText:    { fontSize: 11 },
  customInput:   { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6, fontSize: 11, backgroundColor: '#fff' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  modalCard:     { width: '100%', maxWidth: 480, backgroundColor: '#fff', borderRadius: 12, padding: 16, gap: 8 },
  modalTitle:    { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  libRow:        { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#cbd5e1', gap: 2 },
  libRowLevel:   { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.5 },
  libRowText:    { fontSize: 13, color: '#0f172a' },
})
