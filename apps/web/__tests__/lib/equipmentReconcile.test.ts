import { describe, it, expect } from 'vitest'
import { reconcileEquipment, type RealtimePayload } from '@soteria/core/equipmentReconcile'
import type { Equipment } from '@soteria/core/types'

function mk(id: string, overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id:       id,
    description:        `Equipment ${id}`,
    department:         'Dept A',
    prefix:             null,
    photo_status:       'missing',
    has_equip_photo:    false,
    has_iso_photo:      false,
    equip_photo_url:    null,
    iso_photo_url:      null,
    placard_url:        null,
    signed_placard_url: null,
    notes:              null,
    notes_es:           null,
    internal_notes:     null,
    spanish_reviewed:   false,
    verified:           false,
    verified_date:      null,
    verified_by:        null,
    needs_equip_photo:  true,
    needs_iso_photo:    true,
    needs_verification: true,
    decommissioned:     false,
    annotations:     [],
    iso_annotations:     [],
    created_at:         null,
    updated_at:         null,
    ...overrides,
  }
}

const payload = {
  insert: (row: Equipment): RealtimePayload => ({ eventType: 'INSERT', new: row, old: {} }),
  update: (row: Equipment): RealtimePayload => ({ eventType: 'UPDATE', new: row, old: {} }),
  del:    (id: string):     RealtimePayload => ({ eventType: 'DELETE', new: {}, old: { equipment_id: id } }),
}

describe('reconcileEquipment', () => {
  describe('INSERT', () => {
    it('appends a new row and keeps the list sorted by equipment_id', () => {
      const prev = [mk('A-01'), mk('C-01')]
      const next = reconcileEquipment(prev, payload.insert(mk('B-01')))
      expect(next.map(e => e.equipment_id)).toEqual(['A-01', 'B-01', 'C-01'])
    })

    it('inserts at the end when id sorts last', () => {
      const prev = [mk('A-01'), mk('B-01')]
      const next = reconcileEquipment(prev, payload.insert(mk('Z-01')))
      expect(next.map(e => e.equipment_id)).toEqual(['A-01', 'B-01', 'Z-01'])
    })

    it('inserts at the start when id sorts first', () => {
      const prev = [mk('M-01'), mk('Z-01')]
      const next = reconcileEquipment(prev, payload.insert(mk('A-01')))
      expect(next.map(e => e.equipment_id)).toEqual(['A-01', 'M-01', 'Z-01'])
    })

    it('is idempotent when the same INSERT arrives twice', () => {
      const prev = [mk('A-01', { photo_status: 'partial' })]
      const once = reconcileEquipment(prev, payload.insert(mk('A-01', { photo_status: 'partial' })))
      const twice = reconcileEquipment(once, payload.insert(mk('A-01', { photo_status: 'partial' })))
      expect(once).toBe(prev) // no-op when shallow-equal
      expect(twice).toBe(once)
    })

    it('treats INSERT for an existing id as an update', () => {
      const prev = [mk('A-01', { photo_status: 'missing' })]
      const next = reconcileEquipment(prev, payload.insert(mk('A-01', { photo_status: 'complete' })))
      expect(next).toHaveLength(1)
      expect(next[0].photo_status).toBe('complete')
    })

    it('inserts into an empty list', () => {
      const next = reconcileEquipment([], payload.insert(mk('A-01')))
      expect(next).toHaveLength(1)
      expect(next[0].equipment_id).toBe('A-01')
    })

    it('ignores payloads without an equipment_id', () => {
      const prev = [mk('A-01')]
      const bad: RealtimePayload = { eventType: 'INSERT', new: {}, old: {} }
      expect(reconcileEquipment(prev, bad)).toBe(prev)
    })
  })

  describe('UPDATE', () => {
    it('replaces a row in-place, preserving order', () => {
      const prev = [mk('A-01'), mk('B-01'), mk('C-01')]
      const next = reconcileEquipment(prev, payload.update(mk('B-01', { photo_status: 'complete' })))
      expect(next.map(e => e.equipment_id)).toEqual(['A-01', 'B-01', 'C-01'])
      expect(next[1].photo_status).toBe('complete')
    })

    it('returns the same array reference when the row is unchanged', () => {
      const prev = [mk('A-01', { photo_status: 'partial' })]
      const next = reconcileEquipment(prev, payload.update(mk('A-01', { photo_status: 'partial' })))
      expect(next).toBe(prev)
    })

    it('returns a new array reference when the row changes', () => {
      const prev = [mk('A-01', { decommissioned: false })]
      const next = reconcileEquipment(prev, payload.update(mk('A-01', { decommissioned: true })))
      expect(next).not.toBe(prev)
      expect(next[0].decommissioned).toBe(true)
    })

    it('inserts the row when the UPDATE target is unknown (missed INSERT race)', () => {
      const prev = [mk('A-01'), mk('C-01')]
      const next = reconcileEquipment(prev, payload.update(mk('B-01')))
      expect(next.map(e => e.equipment_id)).toEqual(['A-01', 'B-01', 'C-01'])
    })
  })

  describe('DELETE', () => {
    it('removes the row by old.equipment_id', () => {
      const prev = [mk('A-01'), mk('B-01'), mk('C-01')]
      const next = reconcileEquipment(prev, payload.del('B-01'))
      expect(next.map(e => e.equipment_id)).toEqual(['A-01', 'C-01'])
    })

    it('is a no-op when the id is not present', () => {
      const prev = [mk('A-01'), mk('B-01')]
      const next = reconcileEquipment(prev, payload.del('Z-99'))
      expect(next).toBe(prev)
    })

    it('is a no-op when old.equipment_id is missing', () => {
      const prev = [mk('A-01')]
      const bad: RealtimePayload = { eventType: 'DELETE', new: {}, old: {} }
      expect(reconcileEquipment(prev, bad)).toBe(prev)
    })

    it('handles deleting the only row', () => {
      const prev = [mk('A-01')]
      const next = reconcileEquipment(prev, payload.del('A-01'))
      expect(next).toEqual([])
    })
  })

  describe('decommission flow', () => {
    it('UPDATE toggling decommissioned=true keeps the row in the list', () => {
      const prev = [mk('A-01'), mk('B-01', { decommissioned: false })]
      const next = reconcileEquipment(prev, payload.update(mk('B-01', { decommissioned: true })))
      expect(next).toHaveLength(2)
      expect(next.find(e => e.equipment_id === 'B-01')?.decommissioned).toBe(true)
    })
  })

  describe('sort stability', () => {
    it('uses localeCompare so mixed-case ids sort predictably', () => {
      const prev = [mk('a-01'), mk('B-01')]
      const next = reconcileEquipment(prev, payload.insert(mk('c-01')))
      // localeCompare is case-insensitive by default
      expect(next.map(e => e.equipment_id)).toEqual(['a-01', 'B-01', 'c-01'])
    })
  })
})
