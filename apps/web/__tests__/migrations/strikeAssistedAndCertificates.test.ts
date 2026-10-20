import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../migrations/301_strike_assisted_and_certificates.sql'), 'utf8').replace(/--[^\n]*/g, '')

describe('strike assisted delivery and certificates migration', () => {
  it('lets one signed verification exist per attempt', () => {
    expect(sql).toMatch(/attempt_id\s+uuid not null unique references public\.strike_attempts/)
  })

  it('has no browser write path to verifications', () => {
    expect(sql).toMatch(/create policy strike_assisted_verifications_read on public\.strike_assisted_verifications\s+for select/)
    expect(sql).not.toMatch(/create policy strike_assisted_verifications_(insert|update|delete|write)/)
  })

  it('bounds the stored signature images', () => {
    expect(sql.match(/signature_png\s+text not null check \(signature_png like 'data:image\/png;base64,%' and length\(signature_png\) <= 200000\)/g)).toHaveLength(2)
  })

  it('keeps the certificate signatory to one service-role-only row', () => {
    expect(sql).toMatch(/id\s+boolean primary key default true check \(id\)/)
    expect(sql).toContain('revoke all on public.strike_certificate_signatory from anon, authenticated')
  })

  it('defaults existing attempts to standard delivery', () => {
    expect(sql).toMatch(/add column if not exists delivery text not null default 'standard'\s+check \(delivery in \('standard', 'assisted'\)\)/)
  })
})
