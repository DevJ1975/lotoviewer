import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import EcfaChart from '@/app/incidents/[id]/ecfa/_components/EcfaChart'
import type { EcfaLayoutNode } from '@soteria/core/ecfaSchemas'

// EcfaChart is a pure render of layoutEcfaChart geometry → SVG, so it needs
// no supabase/tenant mocks — just props.

function ev(id: string, seq: number, extra: Partial<EcfaLayoutNode> = {}): EcfaLayoutNode {
  return {
    id, node_type: 'event', sequence_index: seq, parent_event_id: null, lane: null,
    title: `event ${id}`, verification_status: 'presumptive', is_causal_factor: false,
    cf_category: null, ...extra,
  }
}

describe('EcfaChart', () => {
  it('renders the empty-state hint when there are no nodes', () => {
    const { getByText, queryByRole } = render(<EcfaChart nodes={[]} />)
    expect(getByText(/Add events below/i)).toBeInTheDocument()
    expect(queryByRole('img')).toBeNull()
  })

  it('draws a rect per event, an ellipse per condition, and a diamond for the loss', () => {
    const nodes: EcfaLayoutNode[] = [
      ev('a', 0),
      ev('b', 1),
      { id: 'c', node_type: 'condition', sequence_index: 0, parent_event_id: 'a', lane: 'below',
        title: 'interlock bypassed', verification_status: 'presumptive', is_causal_factor: false, cf_category: null },
      { id: 'L', node_type: 'incident', sequence_index: 0, parent_event_id: null, lane: null,
        title: 'amputation', verification_status: 'verified', is_causal_factor: false, cf_category: null },
    ]
    const { container, getByRole } = render(<EcfaChart nodes={nodes} />)
    expect(getByRole('img')).toBeInTheDocument()
    expect(container.querySelectorAll('rect').length).toBeGreaterThanOrEqual(2) // events
    expect(container.querySelectorAll('ellipse').length).toBeGreaterThanOrEqual(1) // condition
    expect(container.querySelectorAll('polygon').length).toBe(1) // loss diamond
  })

  it('shows the causal-factor star + category legend when a factor is coded', () => {
    const nodes: EcfaLayoutNode[] = [
      ev('a', 0, { is_causal_factor: true, cf_category: 'organisational_factors' }),
    ]
    const { getByText, container } = render(<EcfaChart nodes={nodes} />)
    // ★ marker is rendered in the SVG for the highlighted node.
    expect(container.textContent).toContain('★')
    // legend surfaces the used category label
    expect(getByText(/Organisational factors/i)).toBeInTheDocument()
  })
})
