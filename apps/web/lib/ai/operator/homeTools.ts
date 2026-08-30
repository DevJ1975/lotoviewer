import { FEATURES, isModuleVisible } from '@soteria/core'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isAllowedLandingOverride } from '@/lib/landing'
import type { OperatorToolDef } from './types'

// Operator Console HOME-CONFIG tools (Slice 4, Phase A).
//
// The admin-gated `home` sub-agent reconfigures a tenant's landing experience.
// Phase A exposes the two cleanest, lowest-risk levers — the default landing
// path and per-module visibility — plus a read tool so the agent can inspect
// current state before changing it. Each lever already has a live render
// consumer (lib/landing.ts resolves the path on every visit to `/`; the drawer
// + route guard resolve visibility via isModuleVisible), and each write reuses
// the same validation + storage the rest of the app uses:
//   - landing path  → validated by isAllowedLandingOverride, stored in
//                     tenants.settings.default_landing_path (read-modify-write
//                     merge, the same pattern as /api/admin/tenant-settings).
//   - visibility    → stored in tenants.modules[<id>]; module ids are validated
//                     against the live feature catalog (top-level, enabled,
//                     not coming-soon — the domain isModuleVisible resolves).
//
// Branding, assistant suggestions, and command-center signals are deferred:
// they need asset handling, a new render path, or are currently hardcoded.

function ok<T>(data: T): string { return JSON.stringify({ ok: true, data }) }
function fail(message: string): string { return JSON.stringify({ ok: false, error: message }) }

// Top-level modules a tenant can show/hide. Children inherit their parent, and
// coming-soon / globally-disabled features aren't real toggles — so the set the
// agent may touch is exactly the domain isModuleVisible resolves at the top
// level. Computed once from the catalog (the same source the superadmin UI uses).
const TOGGLEABLE_MODULES = FEATURES.filter(f => !f.parent && f.enabled && !f.comingSoon)
const TOGGLEABLE_MODULE_IDS = new Set(TOGGLEABLE_MODULES.map(f => f.id))

// ── get_home_config (read) ──────────────────────────────────────────────────
export const getHomeConfig: OperatorToolDef = {
  agent: 'home',
  minRole: 'admin',
  scope: { kind: 'read' },
  definition: {
    name: 'get_home_config',
    description:
      'Read the tenant\'s current home configuration: the default landing path, the tenant name, and every ' +
      'module the agent can show or hide with its current visibility. Call this before changing anything.',
    input_schema: { type: 'object', properties: {} },
  },
  async handler(_input, ctx) {
    const admin = supabaseAdmin()
    const { data: t, error } = await admin
      .from('tenants')
      .select('name, settings, modules')
      .eq('id', ctx.tenantId)
      .maybeSingle()
    if (error) return fail(error.message)
    if (!t) return fail('Tenant not found.')

    const settings = (t.settings ?? {}) as Record<string, unknown>
    const modules = (t.modules ?? null) as Record<string, boolean> | null
    return ok({
      tenant_name:          (t.name ?? null) as string | null,
      default_landing_path: typeof settings.default_landing_path === 'string' ? settings.default_landing_path : null,
      modules: TOGGLEABLE_MODULES.map(f => ({
        id:      f.id,
        name:    f.name,
        href:    f.href ?? null,
        visible: isModuleVisible(f.id, modules),
      })),
    })
  },
}

// ── set_default_landing_path (write) ────────────────────────────────────────
export const setDefaultLandingPath: OperatorToolDef = {
  agent: 'home',
  minRole: 'admin',
  scope: { kind: 'write' },
  definition: {
    name: 'set_default_landing_path',
    description:
      'Set the page users land on when they open the app at "/". Must point to a module that is enabled and ' +
      'visible for this tenant (e.g. "/loto" or "/confined-spaces/status"). Use get_home_config to see options.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Landing path starting with "/", pointing to a visible enabled module.' },
      },
      required: ['path'],
    },
  },
  async handler(input, ctx) {
    const path = typeof (input as { path?: unknown })?.path === 'string'
      ? (input as { path: string }).path.trim() : ''
    if (!path) return fail('path is required (e.g. "/loto").')

    const admin = supabaseAdmin()
    const { data: t, error } = await admin
      .from('tenants')
      .select('settings, modules')
      .eq('id', ctx.tenantId)
      .maybeSingle()
    if (error) return fail(error.message)
    if (!t) return fail('Tenant not found.')

    const modules = (t.modules ?? null) as Record<string, boolean> | null
    if (!isAllowedLandingOverride(path, modules)) {
      return fail(`'${path}' is not a valid landing path: it must start with "/" and point to a module that is enabled and visible for this tenant.`)
    }

    const settings = (t.settings ?? {}) as Record<string, unknown>
    const { error: upErr } = await admin
      .from('tenants')
      .update({ settings: { ...settings, default_landing_path: path } })
      .eq('id', ctx.tenantId)
    if (upErr) return fail(upErr.message)
    return ok({ default_landing_path: path, note: 'Users will now land here by default.' })
  },
}

// ── set_module_visibility (write) ───────────────────────────────────────────
export const setModuleVisibility: OperatorToolDef = {
  agent: 'home',
  minRole: 'admin',
  scope: { kind: 'write' },
  definition: {
    name: 'set_module_visibility',
    description:
      'Show or hide a top-level module for this tenant. Hiding a module removes it from the drawer/home and ' +
      'blocks direct navigation, but never deletes its data — it is fully reversible. Use get_home_config to list modules.',
    input_schema: {
      type: 'object',
      properties: {
        module_id: { type: 'string', enum: [...TOGGLEABLE_MODULE_IDS], description: 'Which top-level module to show or hide.' },
        visible:   { type: 'boolean', description: 'true to show the module, false to hide it.' },
      },
      required: ['module_id', 'visible'],
    },
  },
  async handler(input, ctx) {
    const i = (input ?? {}) as { module_id?: unknown; visible?: unknown }
    const moduleId = typeof i.module_id === 'string' ? i.module_id.trim() : ''
    if (!TOGGLEABLE_MODULE_IDS.has(moduleId)) {
      return fail(`Unknown module '${moduleId}'. Call get_home_config to list the modules you can show or hide.`)
    }
    if (typeof i.visible !== 'boolean') return fail('visible (true or false) is required.')
    const visible = i.visible

    const admin = supabaseAdmin()
    const { data: t, error } = await admin
      .from('tenants')
      .select('modules')
      .eq('id', ctx.tenantId)
      .maybeSingle()
    if (error) return fail(error.message)
    if (!t) return fail('Tenant not found.')

    const modules = (t.modules ?? {}) as Record<string, boolean>
    const { error: upErr } = await admin
      .from('tenants')
      .update({ modules: { ...modules, [moduleId]: visible } })
      .eq('id', ctx.tenantId)
    if (upErr) return fail(upErr.message)
    return ok({ module_id: moduleId, visible, note: visible ? 'Module is now visible.' : 'Module is now hidden for this tenant.' })
  },
}
