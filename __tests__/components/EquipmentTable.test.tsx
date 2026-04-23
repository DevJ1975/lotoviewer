import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EquipmentTable from '@/components/EquipmentTable'
import type { Equipment } from '@/lib/types'

function makeEquipment(overrides: Partial<Equipment> = {}): Equipment {
  return {
    equipment_id: 'EQ-001',
    description: 'Conveyor Belt Motor',
    department: 'Mechanical',
    prefix: null,
    photo_status: 'complete',
    has_equip_photo: true,
    has_iso_photo: true,
    equip_photo_url: null,
    iso_photo_url: null,
    placard_url: null,
    signed_placard_url: null,
    notes: null,
    notes_es: null,
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

const sampleData: Equipment[] = [
  makeEquipment({ equipment_id: 'EQ-001', description: 'Conveyor Motor',   photo_status: 'complete', department: 'Mech' }),
  makeEquipment({ equipment_id: 'EQ-002', description: 'Air Compressor',   photo_status: 'partial',  department: 'Mech' }),
  makeEquipment({ equipment_id: 'EQ-003', description: 'Hydraulic Pump',   photo_status: 'missing',  department: 'Mech' }),
  makeEquipment({ equipment_id: 'EQ-004', description: 'Cooling Fan Unit', photo_status: 'missing',  department: 'Elec' }),
]

describe('EquipmentTable', () => {
  describe('rendering', () => {
    it('renders all items by default', () => {
      render(<EquipmentTable equipment={sampleData} />)
      expect(screen.getByText('EQ-001')).toBeInTheDocument()
      expect(screen.getByText('EQ-002')).toBeInTheDocument()
      expect(screen.getByText('EQ-003')).toBeInTheDocument()
      expect(screen.getByText('EQ-004')).toBeInTheDocument()
    })

    it('shows correct item count — plural', () => {
      render(<EquipmentTable equipment={sampleData} />)
      expect(screen.getByText('4 items')).toBeInTheDocument()
    })

    it('shows singular "item" count for one result', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.type(screen.getByPlaceholderText(/search/i), 'EQ-001')
      expect(screen.getByText('1 item')).toBeInTheDocument()
    })

    it('shows "No equipment found." when nothing matches', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.type(screen.getByPlaceholderText(/search/i), 'ZZZZZ')
      expect(screen.getByText('No equipment found.')).toBeInTheDocument()
      expect(screen.getByText('0 items')).toBeInTheDocument()
    })

    it('shows "View PDF" link when placard_url is present', () => {
      render(<EquipmentTable equipment={[
        makeEquipment({ placard_url: 'https://example.com/placard.pdf' })
      ]} />)
      const link = screen.getByRole('link', { name: 'View PDF' })
      expect(link).toHaveAttribute('href', 'https://example.com/placard.pdf')
    })

    it('shows "—" when placard_url is null', () => {
      render(<EquipmentTable equipment={[makeEquipment({ placard_url: null })]} />)
      expect(screen.queryByRole('link', { name: 'View PDF' })).not.toBeInTheDocument()
    })

    it('shows "Equipment" label when has_equip_photo is true', () => {
      render(<EquipmentTable equipment={[makeEquipment({ has_equip_photo: true, has_iso_photo: false })]} />)
      expect(screen.getByText('Equipment')).toBeInTheDocument()
    })

    it('shows "ISO" label when has_iso_photo is true', () => {
      render(<EquipmentTable equipment={[makeEquipment({ has_equip_photo: false, has_iso_photo: true })]} />)
      expect(screen.getByText('ISO')).toBeInTheDocument()
    })

    it('shows "Equipment, ISO" when both photos present', () => {
      render(<EquipmentTable equipment={[makeEquipment({ has_equip_photo: true, has_iso_photo: true })]} />)
      expect(screen.getByText('Equipment, ISO')).toBeInTheDocument()
    })
  })

  describe('search', () => {
    it('filters by equipment_id (case-insensitive)', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.type(screen.getByPlaceholderText(/search/i), 'eq-002')
      expect(screen.getByText('EQ-002')).toBeInTheDocument()
      expect(screen.queryByText('EQ-001')).not.toBeInTheDocument()
    })

    it('filters by description (case-insensitive)', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.type(screen.getByPlaceholderText(/search/i), 'hydraulic')
      expect(screen.getByText('EQ-003')).toBeInTheDocument()
      expect(screen.queryByText('EQ-001')).not.toBeInTheDocument()
    })
  })

  describe('status filter', () => {
    it('filters to only missing items', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.click(screen.getByRole('button', { name: 'Missing' }))
      expect(screen.getByText('EQ-003')).toBeInTheDocument()
      expect(screen.getByText('EQ-004')).toBeInTheDocument()
      expect(screen.queryByText('EQ-001')).not.toBeInTheDocument()
      expect(screen.queryByText('EQ-002')).not.toBeInTheDocument()
    })

    it('filters to only partial items', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.click(screen.getByRole('button', { name: 'Partial' }))
      expect(screen.getByText('EQ-002')).toBeInTheDocument()
      expect(screen.queryByText('EQ-001')).not.toBeInTheDocument()
    })

    it('filters to only complete items', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.click(screen.getByRole('button', { name: 'Complete' }))
      expect(screen.getByText('EQ-001')).toBeInTheDocument()
      expect(screen.queryByText('EQ-002')).not.toBeInTheDocument()
    })

    it('All button restores full list', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.click(screen.getByRole('button', { name: 'Missing' }))
      await user.click(screen.getByRole('button', { name: 'All' }))
      expect(screen.getByText('4 items')).toBeInTheDocument()
    })
  })

  describe('sorting', () => {
    it('defaults to ascending equipment_id order', () => {
      // Default state: sortKey='equipment_id', sortAsc=true — no clicks needed
      render(<EquipmentTable equipment={sampleData} />)
      const rows = screen.getAllByRole('row').slice(1)
      expect(within(rows[0]).getByText('EQ-001')).toBeInTheDocument()
      expect(within(rows[3]).getByText('EQ-004')).toBeInTheDocument()
    })

    it('clicking active column header toggles to descending', async () => {
      // equipment_id is already the active sort key; first click reverses it
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.click(screen.getByText(/Equipment ID/))
      const rows = screen.getAllByRole('row').slice(1)
      expect(within(rows[0]).getByText('EQ-004')).toBeInTheDocument()
      expect(within(rows[3]).getByText('EQ-001')).toBeInTheDocument()
    })

    it('clicking active column header twice returns to ascending', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      const header = screen.getByText(/Equipment ID/)
      await user.click(header) // → descending
      await user.click(header) // → ascending again
      const rows = screen.getAllByRole('row').slice(1)
      expect(within(rows[0]).getByText('EQ-001')).toBeInTheDocument()
    })

    it('clicking a new column sorts ascending by that column', async () => {
      const user = userEvent.setup()
      render(<EquipmentTable equipment={sampleData} />)
      await user.click(screen.getByText(/Description/))
      const rows = screen.getAllByRole('row').slice(1)
      // "Air Compressor" comes before "Conveyor Motor" alphabetically
      expect(within(rows[0]).getByText('Air Compressor')).toBeInTheDocument()
    })
  })
})
