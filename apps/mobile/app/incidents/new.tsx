import { router } from 'expo-router'
import { useState } from 'react'
import { KeyboardAvoidingView, Platform, ScrollView, TextInput } from 'react-native'

import { ChipSelect, ErrorBanner, Field, PrimaryButton, formStyles } from '@/components/form'
import ModuleGate from '@/components/ModuleGate'
import { Text, View } from '@/components/Themed'
import { useTenant } from '@/components/TenantProvider'
import { createIncident } from '@/lib/incidents'
import {
  INCIDENT_SEVERITY_ACTUAL,
  INCIDENT_SEVERITY_POTENTIAL,
  INCIDENT_SHIFTS,
  INCIDENT_TYPES,
  INCIDENT_TYPE_LABEL,
  SEVERITY_ACTUAL_LABEL,
  validateCreateInput,
  type IncidentCreateInput,
  type IncidentSeverityActual,
  type IncidentSeverityPotential,
  type IncidentShift,
  type IncidentType,
} from '@soteria/core/incident'

// Fast incident intake. The occurrence time defaults to "now" because a field
// report is almost always filed right after the event; the validator and the
// server share validateCreateInput so errors read the same on both sides.

export default function NewIncidentScreen() {
  return (
    <ModuleGate featureId="incidents" name="Incidents">
      <IncidentForm />
    </ModuleGate>
  )
}

function IncidentForm() {
  const { tenant } = useTenant()
  const [type, setType] = useState<IncidentType | ''>('')
  const [description, setDescription] = useState('')
  const [location, setLocation] = useState('')
  const [shift, setShift] = useState<IncidentShift | ''>('')
  const [actual, setActual] = useState<IncidentSeverityActual | ''>('')
  const [potential, setPotential] = useState<IncidentSeverityPotential | ''>('')
  const [immediate, setImmediate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit() {
    if (!tenant?.id) { setError('Select a workspace first.'); return }
    if (!type) { setError('Pick an incident type.'); return }

    const input: IncidentCreateInput = {
      incident_type:          type,
      occurred_at:            new Date().toISOString(),
      description:            description.trim(),
      location_text:          location.trim() || null,
      shift:                  shift || null,
      // A near miss is by definition "no injury"; default it so the reporter
      // doesn't hit the validator's near-miss rule.
      severity_actual:        actual || (type === 'near_miss' ? 'none' : undefined),
      severity_potential:     potential || null,
      immediate_action_taken: immediate.trim() || null,
    }
    const invalid = validateCreateInput(input)
    if (invalid) { setError(invalid); return }

    setBusy(true); setError(null)
    try {
      const report = await createIncident(tenant.id, input)
      router.replace({ pathname: '/incidents/[id]', params: { id: report.id } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file the report.')
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={formStyles.content} keyboardShouldPersistTaps="handled">
        <Text style={formStyles.subtitle}>
          If anyone needs medical help, call emergency services first. This report notifies your safety team.
        </Text>
        <ErrorBanner message={error} />

        <Field label="Type" required>
          <ChipSelect options={INCIDENT_TYPES} value={type} onChange={setType} labelFor={t => INCIDENT_TYPE_LABEL[t]} />
        </Field>

        <Field label="What happened?" required>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Describe the event in plain language."
            placeholderTextColor="#94a3b8"
            multiline
            style={[formStyles.input, formStyles.multiline]}
          />
        </Field>

        <Field label="Location">
          <TextInput
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Line 3, packaging"
            placeholderTextColor="#94a3b8"
            style={formStyles.input}
          />
        </Field>

        <Field label="Shift">
          <ChipSelect options={INCIDENT_SHIFTS} value={shift} onChange={setShift} />
        </Field>

        <Field label="Actual outcome" hint="Most severe result that happened">
          <ChipSelect options={INCIDENT_SEVERITY_ACTUAL} value={actual} onChange={setActual} labelFor={s => SEVERITY_ACTUAL_LABEL[s]} />
        </Field>

        <Field label="Potential severity" hint="Worst case if it had played out">
          <ChipSelect options={INCIDENT_SEVERITY_POTENTIAL} value={potential} onChange={setPotential} />
        </Field>

        <Field label="Immediate action taken">
          <TextInput
            value={immediate}
            onChangeText={setImmediate}
            placeholder="e.g. Stopped the line, first aid given."
            placeholderTextColor="#94a3b8"
            multiline
            style={[formStyles.input, formStyles.multiline]}
          />
        </Field>

        <View>
          <PrimaryButton label="File incident report" onPress={onSubmit} busy={busy} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
