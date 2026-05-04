import { describe, it, expect, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { SessionProvider, useSession } from '@/components/SessionProvider'

let captured: ReturnType<typeof useSession> | null = null

function Capture() {
  captured = useSession()
  return null
}

function renderWithProvider() {
  captured = null
  return render(<SessionProvider><Capture /></SessionProvider>)
}

describe('SessionProvider', () => {
  beforeEach(() => {
    sessionStorage.clear()
    captured = null
  })

  describe('recents', () => {
    it('starts empty', () => {
      renderWithProvider()
      expect(captured!.recents).toEqual([])
    })

    it('records a visit', () => {
      renderWithProvider()
      act(() => { captured!.recordVisit('EQ-001') })
      expect(captured!.recents).toEqual(['EQ-001'])
    })

    it('dedupes and moves most recent to front', () => {
      renderWithProvider()
      act(() => {
        captured!.recordVisit('EQ-001')
        captured!.recordVisit('EQ-002')
        captured!.recordVisit('EQ-001')
      })
      expect(captured!.recents).toEqual(['EQ-001', 'EQ-002'])
    })

    it('caps at 10 entries, evicting oldest', () => {
      renderWithProvider()
      act(() => {
        for (let i = 1; i <= 12; i++) captured!.recordVisit(`EQ-${i}`)
      })
      expect(captured!.recents).toHaveLength(10)
      expect(captured!.recents[0]).toBe('EQ-12')
      expect(captured!.recents.at(-1)).toBe('EQ-3')
    })

    it('persists recents to sessionStorage', () => {
      renderWithProvider()
      act(() => { captured!.recordVisit('EQ-42') })
      const raw = sessionStorage.getItem('loto:recent')
      expect(raw).toBe(JSON.stringify(['EQ-42']))
    })

    it('ignores empty ids', () => {
      renderWithProvider()
      act(() => { captured!.recordVisit('') })
      expect(captured!.recents).toEqual([])
    })
  })

  describe('flags', () => {
    it('starts with empty flags', () => {
      renderWithProvider()
      expect(captured!.flags.size).toBe(0)
      expect(captured!.isFlagged('EQ-001')).toBe(false)
    })

    it('toggles a flag on and off', () => {
      renderWithProvider()
      act(() => { captured!.toggleFlag('EQ-001') })
      expect(captured!.isFlagged('EQ-001')).toBe(true)
      act(() => { captured!.toggleFlag('EQ-001') })
      expect(captured!.isFlagged('EQ-001')).toBe(false)
    })

    it('tracks multiple flagged items independently', () => {
      renderWithProvider()
      act(() => {
        captured!.toggleFlag('EQ-001')
        captured!.toggleFlag('EQ-002')
      })
      expect(captured!.isFlagged('EQ-001')).toBe(true)
      expect(captured!.isFlagged('EQ-002')).toBe(true)
      expect(captured!.isFlagged('EQ-003')).toBe(false)
    })

    it('clearFlags wipes all flags', () => {
      renderWithProvider()
      act(() => {
        captured!.toggleFlag('EQ-001')
        captured!.toggleFlag('EQ-002')
        captured!.clearFlags()
      })
      expect(captured!.flags.size).toBe(0)
    })

    it('persists flags to sessionStorage', () => {
      renderWithProvider()
      act(() => { captured!.toggleFlag('EQ-555') })
      const raw = sessionStorage.getItem('loto:flags')
      expect(raw).toBe(JSON.stringify(['EQ-555']))
    })
  })

  describe('hydration from sessionStorage', () => {
    it('loads existing recents on mount', () => {
      sessionStorage.setItem('loto:recent', JSON.stringify(['EQ-001', 'EQ-002']))
      renderWithProvider()
      expect(captured!.recents).toEqual(['EQ-001', 'EQ-002'])
    })

    it('loads existing flags on mount', () => {
      sessionStorage.setItem('loto:flags', JSON.stringify(['EQ-001']))
      renderWithProvider()
      expect(captured!.isFlagged('EQ-001')).toBe(true)
    })

    it('falls back to empty arrays when storage is corrupt', () => {
      sessionStorage.setItem('loto:recent', 'not json')
      sessionStorage.setItem('loto:flags',  '{broken')
      renderWithProvider()
      expect(captured!.recents).toEqual([])
      expect(captured!.flags.size).toBe(0)
    })
  })
})
