import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (file: string) => readFileSync(resolve(__dirname, '../../migrations', file), 'utf8')
const sql = read('302_permit_gate_accepts_translations.sql').replace(/--[^\n]*/g, '')

describe('permit gate accepts translations migration', () => {
  it('lets a pass of the pinned module in another language satisfy a version-pinned requirement', () => {
    expect(sql).toMatch(/pinned\.id = r\.module_version_id\s+and passed\.id = sc\.module_version_id\s+and passed\.locale <> pinned\.locale/)
    expect(sql).toMatch(/join public\.strike_module_versions passed on passed\.module_id = pinned\.module_id/)
  })

  it('changes nothing else in permit_training_status', () => {
    const fn = (text: string) => text.slice(
      text.indexOf('create or replace function public.permit_training_status('),
      text.indexOf('grant  execute on function public.permit_training_status'),
    )
    const pinPredicate = /and \(r\.module_version_id is null[\s\S]*?\)\)?\n(?=\s+and exists)/
    const original = fn(read('296_permit_training_gate.sql')).replace(pinPredicate, '<pin>\n')
    const updated = fn(read('302_permit_gate_accepts_translations.sql')).replace(pinPredicate, '<pin>\n')
    expect(updated).toBe(original)
  })

  it('keeps the function closed to anonymous callers', () => {
    expect(sql).toContain('revoke execute on function public.permit_training_status(uuid, text, uuid, uuid[]) from anon, public')
  })
})
