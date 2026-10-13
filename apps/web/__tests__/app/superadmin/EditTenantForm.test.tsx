// The superadmin edit form posts its whole module map on every save, so the
// checkbox each module starts with must match what the tenant sees today.
// If an opt-in module started checked, renaming a tenant would silently
// switch the module on.

import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import type { Tenant } from '@soteria/core/types'
import { EditTenantForm } from '@/app/superadmin/tenants/[number]/_components/EditTenantForm'

const superadminJsonMock = vi.fn()
vi.mock('@/lib/superadminFetch', () => ({
  superadminJson: (...a: unknown[]) => superadminJsonMock(...a),
}))

function tenantWith(modules: Record<string, boolean>): Tenant {
  return {
    id: 't1', tenant_number: '0009', slug: 'acme', name: 'Acme', status: 'active',
    is_demo: false, disabled_at: null, modules, logo_url: null, custom_domain: null,
    settings: {}, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }
}

// Each module row is a <label> holding the checkbox and the module's name.
function checkboxFor(moduleName: string): HTMLInputElement {
  const label = screen.getByText(moduleName, { exact: true }).closest('label')
  if (!label) throw new Error(`no module row for ${moduleName}`)
  return within(label).getByRole('checkbox') as HTMLInputElement
}

async function saveAndReadPostedModules(): Promise<Record<string, boolean>> {
  fireEvent.submit(screen.getByRole('button', { name: /save/i }).closest('form')!)
  await waitFor(() => expect(superadminJsonMock).toHaveBeenCalledTimes(1))
  const [, init] = superadminJsonMock.mock.calls[0] as [string, { body: string }]
  return JSON.parse(init.body).modules
}

beforeEach(() => {
  superadminJsonMock.mockReset()
  superadminJsonMock.mockResolvedValue({ ok: true, body: { tenant: tenantWith({}) } })
})

describe('EditTenantForm module checkboxes', () => {
  it('starts an opt-in module unchecked and a default-on module checked when the tenant has no overrides', () => {
    render(<EditTenantForm tenantNumber="0009" tenant={tenantWith({})} onSaved={() => {}} />)
    expect(checkboxFor('Environmental (ISO 14001)').checked).toBe(false)
    expect(checkboxFor('LOTO').checked).toBe(true)
  })

  it('saving without touching the modules does not switch the opt-in module on', async () => {
    render(<EditTenantForm tenantNumber="0009" tenant={tenantWith({})} onSaved={() => {}} />)
    const posted = await saveAndReadPostedModules()
    expect(posted.environmental).toBe(false)
    expect(posted.loto).toBe(true)
  })

  it('keeps an opted-in tenant opted in across a save', async () => {
    render(<EditTenantForm tenantNumber="0009" tenant={tenantWith({ environmental: true })} onSaved={() => {}} />)
    expect(checkboxFor('Environmental (ISO 14001)').checked).toBe(true)
    expect((await saveAndReadPostedModules()).environmental).toBe(true)
  })

  it('shows an explicit opt-out of a default-on module as unchecked', () => {
    render(<EditTenantForm tenantNumber="0009" tenant={tenantWith({ loto: false })} onSaved={() => {}} />)
    expect(checkboxFor('LOTO').checked).toBe(false)
  })
})
