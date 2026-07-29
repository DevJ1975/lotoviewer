import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'

// EcfaBoard is a client component that loads its nodes via fetch and reads the
// session from supabase. Mock both so it renders deterministically. We assert
// only that rows render and that read-only hides the drag + add affordances —
// the reorder/move math is unit-tested in @soteria/core, and react-aria pointer
// drags are not reliably simulable in jsdom.
vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}))

import EcfaBoard from '@/app/incidents/[id]/ecfa/_components/EcfaBoard'

const NODES = [{
  id: 'e1', tenant_id: 't', investigation_id: 'i', node_type: 'event', sequence_index: 1,
  parent_event_id: null, lane: null, title: 'Operator opened the door', description: null,
  occurred_at: null, verification_status: 'presumptive', is_causal_factor: false,
  cf_category: null, failed_barrier: null, cf_hierarchy_control: null, created_at: '', updated_at: '',
}]

function mockFetch() {
  return vi.fn(async (url: string | URL) => {
    const u = String(url)
    if (u.endsWith('/ecfa')) return { ok: true, json: async () => ({ investigation_id: 'i', nodes: NODES }) }
    if (u.endsWith('/actions')) return { ok: true, json: async () => ({ actions: [] }) }
    return { ok: true, json: async () => ({}) }
  })
}

describe('EcfaBoard', () => {
  beforeEach(() => { vi.stubGlobal('fetch', mockFetch()) })
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('renders events with drag + add affordances when editable', async () => {
    const { getByText, queryAllByLabelText } = render(
      <EcfaBoard incidentId="i" tenantId="t" isAdmin={false} readOnly={false} />,
    )
    await waitFor(() => expect(getByText('Operator opened the door')).toBeInTheDocument())
    expect(getByText(/Add event/i)).toBeInTheDocument()
    expect(queryAllByLabelText(/Reorder event/i).length).toBeGreaterThan(0)
  })

  it('hides drag + add affordances when read-only', async () => {
    const { getByText, queryByText, queryAllByLabelText } = render(
      <EcfaBoard incidentId="i" tenantId="t" isAdmin={false} readOnly />,
    )
    await waitFor(() => expect(getByText('Operator opened the door')).toBeInTheDocument())
    expect(queryByText(/Add event/i)).toBeNull()
    expect(queryAllByLabelText(/Reorder event/i)).toHaveLength(0)
  })
})
