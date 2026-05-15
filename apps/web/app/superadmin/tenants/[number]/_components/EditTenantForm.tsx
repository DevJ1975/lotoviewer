'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import { getModules, type FeatureCategory, type FeatureDef } from '@soteria/core/features'
import type { Tenant, TenantStatus } from '@soteria/core/types'
import {
  TOOLBOX_TALK_INDUSTRY_OPTIONS,
  normalizeToolboxTalkIndustry,
  type ToolboxTalkIndustry,
} from '@/lib/toolboxTalkPacks'
import { Section } from './Section'

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  safety:  'Safety',
  reports: 'Reports',
  admin:   'Admin',
}
const CATEGORY_ORDER: FeatureCategory[] = ['safety', 'reports', 'admin']
const STATUSES: TenantStatus[] = ['active', 'trial', 'disabled', 'archived']

interface Props {
  tenantNumber: string
  tenant:       Tenant
  onSaved:      (next: Tenant) => void
}

// Single Save button persists name + status + is_demo + modules in one
// PATCH. Local state mirrors the tenant; resets when `tenant` changes
// (e.g. parent re-fetched after a logo upload).
//
// Module-state seeding is deliberate: the drawer's visibility resolver
// treats a MISSING key as "use static `enabled`" (defaults to visible
// for top-level admin entries). If we initialised the form purely from
// tenant.modules, those defaulted-true entries would show as unchecked
// and a save would persist them as false, silently hiding modules
// that were visible. Seed every catalog feature from its static
// enabled value, then overlay the tenant's explicit overrides.
function seedModulesFromTenant(tenant: Tenant): Record<string, boolean> {
  const seeded: Record<string, boolean> = {}
  const allFeatures: FeatureDef[] = (['safety', 'reports', 'admin'] as const)
    .flatMap(cat => getModules(cat))
    .filter(m => !m.comingSoon)
  for (const f of allFeatures) seeded[f.id] = f.enabled
  for (const [k, v] of Object.entries(tenant.modules ?? {})) seeded[k] = v === true
  return seeded
}

export function EditTenantForm({ tenantNumber, tenant, onSaved }: Props) {
  const [name,    setName]    = useState(tenant.name)
  const [status,  setStatus]  = useState<TenantStatus>(tenant.status)
  const [isDemo,  setIsDemo]  = useState(tenant.is_demo)
  const [modules, setModules] = useState<Record<string, boolean>>(() => seedModulesFromTenant(tenant))
  // tenants.settings is a free-form jsonb. We expose known
  // keys with explicit form fields; everything else is editable as
  // raw JSON below. Saving merges the explicit fields back into
  // the JSON before PATCH so the server receives one settings
  // object.
  // The textarea shows every settings key EXCEPT dedicated controls
  // like anthropic_api_key and toolbox_industry. Stripping them keeps
  // one source of truth for each setting and avoids the "edit it in
  // both places, hope they agree" trap.
  const [settingsJson, setSettingsJson] = useState<string>(() => {
    const { anthropic_api_key: _dropKey, toolbox_industry: _dropIndustry, ...rest } = (tenant.settings ?? {}) as Record<string, unknown>
    void _dropKey
    void _dropIndustry
    return JSON.stringify(rest, null, 2)
  })
  const [settingsError, setSettingsError] = useState<string | null>(null)

  const [toolboxIndustry, setToolboxIndustry] = useState<ToolboxTalkIndustry>(() =>
    normalizeToolboxTalkIndustry((tenant.settings as Record<string, unknown> | null | undefined)?.toolbox_industry),
  )

  // Dedicated Anthropic API key input. Mirrors a single key inside
  // tenants.settings.anthropic_api_key. Pulled out of the free-form
  // JSON textarea above so an operator pasting a key from the
  // Anthropic Console (a) doesn't have to wrap it in JSON syntax,
  // and (b) gets fail-fast validation client-side instead of finding
  // out the AI is silently 401-ing for that tenant.
  const initialKey = (() => {
    const v = (tenant.settings as Record<string, unknown> | null | undefined)?.['anthropic_api_key']
    return typeof v === 'string' ? v : ''
  })()
  const [anthropicKey, setAnthropicKey] = useState<string>(initialKey)
  const [keyError,     setKeyError]     = useState<string | null>(null)

  // Re-seed when the parent re-fetches the tenant (e.g. after logo
  // upload). Keep the user's in-flight checkbox edits if they've
  // touched the form — otherwise the re-fetch would clobber them.
  // The parent owns the canonical tenant object; when it refreshes, the
  // form should mirror the server copy again.
  useEffect(() => {
    setModules(seedModulesFromTenant(tenant))
    const { anthropic_api_key: _dropKey, toolbox_industry: _dropIndustry, ...rest } = (tenant.settings ?? {}) as Record<string, unknown>
    void _dropKey
    void _dropIndustry
    setSettingsJson(JSON.stringify(rest, null, 2))
    setSettingsError(null)
    setToolboxIndustry(normalizeToolboxTalkIndustry((tenant.settings as Record<string, unknown> | null | undefined)?.toolbox_industry))
    const v = (tenant.settings as Record<string, unknown> | null | undefined)?.['anthropic_api_key']
    setAnthropicKey(typeof v === 'string' ? v : '')
    setKeyError(null)
  }, [tenant])

  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const moduleGroups = useMemo(
    () => CATEGORY_ORDER.map(cat => ({
      category: cat,
      label:    CATEGORY_LABELS[cat],
      modules:  getModules(cat).filter(m => !m.comingSoon),
    })).filter(g => g.modules.length > 0),
    [],
  )

  function toggleModule(id: string) {
    setModules(prev => ({ ...prev, [id]: !prev[id] }))
    setSaveSuccess(false)
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true); setSaveError(null); setSaveSuccess(false); setSettingsError(null); setKeyError(null)

    // Validate the settings JSON before sending. A typo here
    // shouldn't lose the rest of the form's edits, so surface the
    // error inline + abort the PATCH.
    let parsedSettings: Record<string, unknown> = {}
    try {
      const trimmed = settingsJson.trim()
      parsedSettings = trimmed === '' ? {} : JSON.parse(trimmed)
      if (typeof parsedSettings !== 'object' || Array.isArray(parsedSettings) || parsedSettings === null) {
        throw new Error('Settings must be a JSON object (not array, not primitive).')
      }
    } catch (e) {
      setSettingsError(e instanceof Error ? e.message : 'Invalid JSON')
      setSaving(false)
      return
    }

    parsedSettings = { ...parsedSettings, toolbox_industry: toolboxIndustry }

    // Anthropic key validation. Empty = remove override (env fallback);
    // non-empty must look like a real key. Server enforces the same
    // shape via lib/ai/getTenantApiKey.looksLikeAnthropicKey, but we
    // reject obvious typos client-side to spare the round-trip.
    const trimmedKey = anthropicKey.trim()
    if (trimmedKey.length > 0) {
      if (!trimmedKey.startsWith('sk-ant-')) {
        setKeyError('Anthropic keys start with "sk-ant-". Paste the key from the Anthropic Console.')
        setSaving(false)
        return
      }
      if (trimmedKey.length < 30) {
        setKeyError('That key looks truncated (under 30 characters). Real keys are ~100 characters.')
        setSaving(false)
        return
      }
      parsedSettings = { ...parsedSettings, anthropic_api_key: trimmedKey }
    } else if ('anthropic_api_key' in parsedSettings) {
      // Operator cleared the field — remove the override so the
      // platform env key is used.
      const { anthropic_api_key: _drop, ...rest } = parsedSettings
      void _drop
      parsedSettings = rest
    }

    const result = await superadminJson<{ tenant: Tenant }>(
      `/api/superadmin/tenants/${tenantNumber}`,
      {
        method: 'PATCH',
        body:   JSON.stringify({
          name:     name.trim(),
          status,
          is_demo:  isDemo,
          modules,
          settings: parsedSettings,
        }),
      },
    )
    if (!result.ok || !result.body) {
      setSaveError(result.error ?? 'Save failed')
    } else {
      onSaved(result.body.tenant)
      setSaveSuccess(true)
    }
    setSaving(false)
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <Section title="Basic info">
        <div className="space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Name</label>
            <input
              id="name"
              type="text"
              required
              maxLength={200}
              value={name}
              onChange={e => { setName(e.target.value); setSaveSuccess(false) }}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            />
          </div>

          <div>
            <label htmlFor="status" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Status</label>
            <select
              id="status"
              value={status}
              onChange={e => { setStatus(e.target.value as TenantStatus); setSaveSuccess(false) }}
              className="w-full px-3 py-2 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            >
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Setting <span className="font-mono">disabled</span> hides the tenant&apos;s data from all users (RLS) but preserves it for audit.
            </p>
          </div>

          <div className="flex items-start gap-2">
            <input
              id="is_demo"
              type="checkbox"
              checked={isDemo}
              onChange={e => { setIsDemo(e.target.checked); setSaveSuccess(false) }}
              className="mt-1 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
            />
            <label htmlFor="is_demo" className="text-sm text-slate-700 dark:text-slate-200">
              <span className="font-medium">Demo tenant</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">Eligible for &quot;Reset Demo&quot;.</span>
            </label>
          </div>
        </div>
      </Section>

      <Section title="Modules">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Top-level modules. Children inherit their parent&apos;s setting.
        </p>
        <div className="space-y-5">
          {moduleGroups.map(g => (
            <div key={g.category}>
              <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">{g.label}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {g.modules.map(m => (
                  <ModuleCheckbox
                    key={m.id}
                    module={m}
                    checked={modules[m.id] === true}
                    onToggle={() => toggleModule(m.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Anthropic API key (optional override)">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Per-tenant override for the platform&apos;s default <code className="font-mono text-[11px]">ANTHROPIC_API_KEY</code>.
          When set, this tenant&apos;s AI features bill to its own Anthropic account.
          Leave blank to use the platform default. <strong>A malformed key here causes
          AI features to fail fast with a 502 (no silent fallback).</strong>
        </p>
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={anthropicKey}
          onChange={e => { setAnthropicKey(e.target.value); setKeyError(null); setSaveSuccess(false) }}
          className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
        />
        {keyError && (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{keyError}</p>
        )}
        {!keyError && anthropicKey.trim().length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
            Stored under <code className="font-mono">settings.anthropic_api_key</code>. Clear the field and Save to remove the override.
          </p>
        )}
      </Section>

      <Section title="Toolbox talk package">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Selects the AI topic pack and writing guidance used by the scheduled toolbox-talk generator.
          Stored under <code className="font-mono text-[11px]">settings.toolbox_industry</code>.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {TOOLBOX_TALK_INDUSTRY_OPTIONS.map(option => (
            <label
              key={option.value}
              className="flex items-start gap-2 p-3 rounded-md border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-colors"
            >
              <input
                type="radio"
                name="toolbox_industry"
                value={option.value}
                checked={toolboxIndustry === option.value}
                onChange={() => { setToolboxIndustry(option.value); setSaveSuccess(false) }}
                className="mt-0.5 h-4 w-4 border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">{option.label}</span>
                <span className="block text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
      </Section>

      <Section title="Settings (advanced)">
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
          Free-form JSON. Common keys: <code className="font-mono text-[11px]">default_landing_path</code>,
          {' '}<code className="font-mono text-[11px]">risk_band_scheme</code>,
          {' '}<code className="font-mono text-[11px]">risk_acceptance_threshold</code>.
          The <code className="font-mono text-[11px]">anthropic_api_key</code> and <code className="font-mono text-[11px]">toolbox_industry</code> keys are edited above and hidden here on purpose.
          See <code className="font-mono text-[11px]">tenants.settings</code> in the schema.
        </p>
        <textarea
          value={settingsJson}
          onChange={e => { setSettingsJson(e.target.value); setSettingsError(null) }}
          rows={8}
          spellCheck={false}
          className="w-full px-3 py-2 text-xs font-mono rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
        />
        {settingsError && (
          <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">
            {settingsError}
          </p>
        )}
      </Section>

      {saveError && (
        <div className="p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{saveError}</p>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 flex gap-2 items-center">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <p className="text-sm text-emerald-800 dark:text-emerald-200">Saved.</p>
        </div>
      )}

      <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function ModuleCheckbox({
  module: m, checked, onToggle,
}: { module: FeatureDef; checked: boolean; onToggle: () => void }) {
  return (
    <label className="flex items-start gap-2 p-2 rounded-md border border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-brand-navy focus:ring-brand-navy"
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-200">{m.name}</div>
        <div className="text-[11px] text-slate-500 dark:text-slate-400 leading-snug">{m.description}</div>
      </div>
    </label>
  )
}
