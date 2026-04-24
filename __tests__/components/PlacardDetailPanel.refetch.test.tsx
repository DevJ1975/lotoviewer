/**
 * Regression test: PlacardDetailPanel must NOT re-fetch energy steps when
 * the parent passes a new `equipment` object that still represents the
 * same row (which happens on every realtime tick in HomeDashboard — any
 * DB change creates a new equipment array, and `selectedEquipment` gets
 * a new object reference even when only an unrelated row updated).
 *
 * Previous behavior: useEffect dep array was `[equipment]`. Each realtime
 * tick triggered another loto_energy_steps SELECT — hundreds of redundant
 * round-trips per hour per field device.
 *
 * Fix: depend on `equipment?.equipment_id` so the effect only re-fires on
 * actual selection changes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { act } from 'react'
import PlacardDetailPanel from '@/components/dashboard/PlacardDetailPanel'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@/lib/types'

// Capture the full fetch chain so we can both mock the returned data and
// count how many times it was invoked across renders.
const thenSpy = vi.fn()

vi.mock('@/lib/supabase', () => {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    order:  vi.fn().mockReturnThis(),
    then:   (onFulfilled: (v: { data: unknown[]; error: null }) => void) => {
      thenSpy()
      onFulfilled({ data: [], error: null })
      return Promise.resolve()
    },
  }
  return {
    supabase: {
      from: vi.fn(() => chain),
    },
  }
})

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) =>
    <a href={href}>{children}</a>,
}))

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001',
    description: 'Main pump',
    department: 'Utilities',
    prefix: null,
    photo_status: 'complete',
    has_equip_photo: true,
    has_iso_photo: true,
    equip_photo_url: 'https://example.com/e.jpg',
    iso_photo_url: 'https://example.com/i.jpg',
    placard_url: null,
    signed_placard_url: null,
    notes: null,
    notes_es: null,
    internal_notes: null,
    spanish_reviewed: false,
    verified: false,
    verified_date: null,
    verified_by: null,
    needs_equip_photo: true,
    needs_iso_photo: true,
    needs_verification: false,
    decommissioned: false,
    created_at: null,
    updated_at: null,
    ...overrides,
  }
}

describe('PlacardDetailPanel — re-fetch invariants', () => {
  beforeEach(() => {
    thenSpy.mockClear()
    vi.mocked(supabase.from).mockClear()
  })

  it('fetches once on initial mount when an equipment is selected', async () => {
    await act(async () => {
      render(<PlacardDetailPanel equipment={makeEquipment()} />)
    })
    expect(thenSpy).toHaveBeenCalledTimes(1)
  })

  it('does NOT re-fetch when the parent passes a new object for the same row', async () => {
    // Simulates a realtime tick: same equipment_id, new object reference,
    // possibly stale/fresh non-key fields updated. The hook should notice
    // only the id-level change (none), not the reference-level change.
    const { rerender } = render(<PlacardDetailPanel equipment={makeEquipment()} />)

    await act(async () => {
      // New object, same id — what HomeDashboard produces on every
      // reconcileEquipment pass when an unrelated row updated.
      rerender(<PlacardDetailPanel equipment={makeEquipment({ updated_at: '2026-04-23T00:00:00Z' })} />)
    })
    await act(async () => {
      rerender(<PlacardDetailPanel equipment={makeEquipment({ description: 'Main pump — relabeled' })} />)
    })
    await act(async () => {
      rerender(<PlacardDetailPanel equipment={makeEquipment()} />)
    })

    // Still exactly one fetch from the initial mount.
    expect(thenSpy).toHaveBeenCalledTimes(1)
  })

  it('DOES re-fetch when selection changes to a different equipment_id', async () => {
    const { rerender } = render(<PlacardDetailPanel equipment={makeEquipment({ equipment_id: 'EQ-001' })} />)

    await act(async () => {
      rerender(<PlacardDetailPanel equipment={makeEquipment({ equipment_id: 'EQ-002' })} />)
    })

    // One fetch on mount + one on selection change.
    expect(thenSpy).toHaveBeenCalledTimes(2)
  })

  it('clears steps and does NOT fetch when equipment becomes null', async () => {
    const { rerender } = render(<PlacardDetailPanel equipment={makeEquipment()} />)
    expect(thenSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      rerender(<PlacardDetailPanel equipment={null} />)
    })

    // Still just the initial fetch — deselection should not trigger a new one.
    expect(thenSpy).toHaveBeenCalledTimes(1)
  })
})
