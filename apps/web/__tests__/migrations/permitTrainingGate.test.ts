import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Migration-TEXT assertions (no database in the unit suite). Behavioural
// proof on a Supabase branch, after configuring a required_before_start
// requirement for hot_work: signing a permit whose operator has no current
// completion must raise check_violation "TRAINING_REQUIRED: …".

const sql = readFileSync(resolve(__dirname, '../../migrations/296_permit_training_gate.sql'), 'utf8')
  .replace(/--[^\n]*/g, '')

function fn(name: string): string {
  const match = sql.match(new RegExp(String.raw`function public\.${name}\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$`))
  if (!match) throw new Error(`function ${name} not found`)
  return match[1]
}

describe('permit_training_gate migration', () => {
  it('enforces at the moment of issue for every gated permit type', () => {
    expect(sql).toMatch(/before insert or update of entry_supervisor_signature_at on public\.loto_confined_space_permits/)
    expect(sql).toMatch(/before insert or update of pai_signature_at on public\.loto_hot_work_permits/)
    expect(sql).toMatch(/before insert or update of status on public\.wah_permits/)
    expect(sql).toMatch(/before insert on public\.loto_group_permits/)
    expect(sql).toMatch(/before insert on public\.loto_group_permit_members/)
  })

  it('also gates crew added to an already-issued permit', () => {
    expect(sql).toMatch(/create trigger permit_workers_training_gate\s+before insert on public\.permit_workers/)
  })

  it('raises a recognisable, actionable error', () => {
    const body = fn('assert_permit_training')
    expect(body).toContain("'TRAINING_REQUIRED:")
    expect(body).toContain("errcode = 'check_violation'")
    expect(body).toContain("s.status = 'missing'")
  })

  it('counts only passing, unexpired completions at or above the supersession floor', () => {
    const body = fn('permit_training_status')
    expect(body).toContain('sc.passed')
    expect(body).toContain('sc.expires_at is null or sc.expires_at > now()')
    expect(body).toContain('filter (where v.supersedes_completions)')
    expect(body).toContain('r.module_version_id is null or sc.module_version_id = r.module_version_id')
  })

  it('refuses cross-tenant status reads by end users of the security-definer function', () => {
    const body = fn('permit_training_status')
    expect(body).toContain('current_user_tenant_ids()')
    expect(body).toContain("errcode = 'insufficient_privilege'")
    expect(sql).toMatch(/revoke execute on function public\.permit_training_status\(uuid, text, uuid, uuid\[\]\) from anon, public/)
  })

  it('makes overrides owner/admin-only, self-attributed, reasoned and append-only', () => {
    const insert = sql.match(/create policy permit_training_overrides_insert[\s\S]*?;/)?.[0] ?? ''
    expect(insert).toContain('granted_by = auth.uid()')
    expect(insert).toContain('current_user_admin_tenant_ids()')
    expect(sql).toMatch(/reason\s+text not null check \(length\(btrim\(reason\)\) >= 20\)/)
    expect(sql).not.toMatch(/create policy permit_training_overrides_(update|delete)/)
    expect(sql).toMatch(/create trigger permit_training_overrides_audit/)
  })

  it('refuses an issuer who is not on the roster once the permit type is gated, instead of skipping them', () => {
    const body = fn('gated_issuer_member')
    expect(body.indexOf('permit_type_is_gated')).toBeLessThan(body.indexOf('member_for_profile'))
    expect(body).toContain("'TRAINING_REQUIRED: the person issuing this permit is not on the roster")
    for (const call of [
      "gated_issuer_member(new.tenant_id, 'confined_space', new.id, new.entry_supervisor_id)",
      "gated_issuer_member(new.tenant_id, 'hot_work', new.id, new.pai_id)",
      "gated_issuer_member(new.tenant_id, 'loto_group', new.id, new.primary_authorized_employee_id)",
    ]) expect(sql).toContain(call)
  })

  it('only demands a roster entry for a LOTO group join when the permit type is gated', () => {
    const body = fn('gate_loto_group_member_join')
    expect(body.indexOf('permit_type_is_gated')).toBeGreaterThan(-1)
    expect(body.indexOf('permit_type_is_gated')).toBeLessThan(body.indexOf('not on the roster'))
  })
})
