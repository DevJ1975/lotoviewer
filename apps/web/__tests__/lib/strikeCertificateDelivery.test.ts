import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { parseCertificateRecipient } from '@/lib/strike/certificateDelivery'
import { loadCertificateRecord } from '@/lib/strike/certificateRecord'

// A certificate is only ever built from the learner's own completion row.

function fakeAdmin(rows: Record<string, unknown>) {
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq']) chain[m] = () => chain
      chain.maybeSingle = async () => ({ data: rows[table] ?? null, error: null })
      return chain
    },
  }
  return admin as unknown as SupabaseClient
}

const completion = {
  id: 'c1', tenant_id: 't1', module_id: 'mod-1', module_version_id: 'ver-1', user_id: null, member_id: 'm1',
  completed_at: '2026-10-20T12:00:00Z', score_percent: null,
  evidence: { mode: 'assisted_verified', verifier_name: 'Sam Supervisor' },
}

describe('parseCertificateRecipient', () => {
  it('accepts a personal or work address and trims it', () => {
    expect(parseCertificateRecipient('  ana.ruiz@gmail.com ')).toBe('ana.ruiz@gmail.com')
  })

  it('rejects anything that is not one plausible address', () => {
    for (const bad of ['', 'ana', 'ana@', 'a@b', 'a b@c.com', 'a@b.com, c@d.com', 42, null]) {
      expect(parseCertificateRecipient(bad)).toBeNull()
    }
  })
})

describe('loadCertificateRecord', () => {
  it("builds the Spanish, supervisor-verified certificate from the learner's own completion", async () => {
    const admin = fakeAdmin({
      strike_completions: completion,
      strike_modules: { title: 'LOTO 101: Control of Hazardous Energy' },
      strike_module_versions: { title: 'LOTO 101: Control de energía peligrosa', locale: 'es' },
      tenants: { name: 'WLS Demo' },
      members: { preferred_name: null, display_name: 'Ana Ruiz' },
      strike_certificate_signatory: null,
    })
    const result = await loadCertificateRecord(admin, { tenantId: 't1', userId: null, memberId: 'm1' }, 'att-1')
    expect(result.ok && result.value.data).toMatchObject({
      locale: 'es',
      learnerName: 'Ana Ruiz',
      moduleTitle: 'LOTO 101: Control de energía peligrosa',
      organization: 'WLS Demo',
      reference: 'att-1',
      result: { kind: 'verified', verifierName: 'Sam Supervisor' },
      signatory: null,
    })
  })

  it("refuses another worker's completion", async () => {
    const admin = fakeAdmin({ strike_completions: completion })
    const result = await loadCertificateRecord(admin, { tenantId: 't1', userId: null, memberId: 'someone-else' }, 'att-1')
    expect(result).toMatchObject({ ok: false, status: 404 })
  })
})
