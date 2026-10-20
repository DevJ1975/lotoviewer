import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../migrations/303_strike_gate_and_assignment_visibility.sql'), 'utf8').replace(/--[^\n]*/g, '')

describe('migration 303: permit gate per requirement, department and site visibility', () => {
  it('grades each requirement on its own, so a stricter one on the same module is not merged away', () => {
    expect(sql).toMatch(/select r\.id, r\.module_id, r\.module_version_id/)
    expect(sql).toMatch(/group by c\.member_id, r\.id\b/)
    expect(sql).toMatch(/join reqs r on r\.id = b\.requirement_id/)
    expect(sql).not.toMatch(/group by c\.member_id, r\.module_id/)
  })

  it('names only members of the tenant asked about', () => {
    expect(sql.match(/join public\.members mem on mem\.id = [bc]\.member_id and mem\.tenant_id = p_tenant_id/g)).toHaveLength(2)
  })

  it('keeps the function closed to anonymous callers', () => {
    expect(sql).toContain('revoke execute on function public.permit_training_status(uuid, text, uuid, uuid[]) from anon, public')
  })

  it("shows learners the department and site assignments the app applies to them, keeping every other clause", () => {
    expect(sql).toMatch(/target_type in \('department', 'site'\)/)
    expect(sql).toMatch(/lower\(btrim\(case when strike_assignments\.target_type = 'department' then mem\.department else mem\.site_label end\)\)\s*= lower\(btrim\(strike_assignments\.target_id\)\)/)
    for (const clause of [/target_type = 'tenant'/, /target_type = 'user' and target_id = \(select auth\.uid\(\)\)::text/, /target_type = 'member'/, /target_type = 'role'/]) {
      expect(sql).toMatch(clause)
    }
  })
})
