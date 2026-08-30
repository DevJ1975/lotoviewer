import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Eye } from 'lucide-react'

import { DashboardPanel, PanelEyebrow, PanelLink } from '@/components/DashboardPanel'

// Eight dashboard panels hand-rolled the same header, so the contract that
// matters is structural: the title is the section's heading (screen-reader
// users navigate by heading, not by eyebrow), and the eyebrow is not.

describe('DashboardPanel', () => {
  it('exposes the title as the section heading', () => {
    render(
      <DashboardPanel eyebrow="Risk Assessment · ISO 45001 6.1" title="Risk intelligence">
        <p>body</p>
      </DashboardPanel>,
    )
    expect(screen.getByRole('heading', { name: 'Risk intelligence' })).toBeInTheDocument()
  })

  it('does not make the eyebrow a heading — it is context, not structure', () => {
    render(
      <DashboardPanel eyebrow="Regulatory Watch" title="Coming up">
        <p>body</p>
      </DashboardPanel>,
    )
    expect(screen.getByText('Regulatory Watch')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Regulatory Watch' })).not.toBeInTheDocument()
  })

  it('renders children inside the panel', () => {
    render(
      <DashboardPanel eyebrow="e" title="t">
        <p>the metrics</p>
      </DashboardPanel>,
    )
    expect(screen.getByText('the metrics')).toBeInTheDocument()
  })

  it('renders the action slot when given one', () => {
    render(
      <DashboardPanel eyebrow="e" title="t" action={<PanelLink href="/risk">Heat map</PanelLink>}>
        <p>body</p>
      </DashboardPanel>,
    )
    expect(screen.getByRole('link', { name: /Heat map/ })).toHaveAttribute('href', '/risk')
  })

  // OpenActionsPanel passes `rows.length > LIMIT && <span/>`, which is `false`
  // when the list is short. That must render nothing, not an empty wrapper.
  it('renders no action wrapper for a falsy action', () => {
    const { container } = render(
      <DashboardPanel eyebrow="e" title="t" action={false}>
        <p>body</p>
      </DashboardPanel>,
    )
    const header = container.querySelector('header')
    expect(header?.children).toHaveLength(1)
  })

  it('renders the optional icon', () => {
    const { container } = render(
      <DashboardPanel icon={Eye} eyebrow="Behavior-Based Safety" title="Observation program">
        <p>body</p>
      </DashboardPanel>,
    )
    expect(container.querySelector('svg')).toBeInTheDocument()
  })

  it('speaks the placard vocabulary rather than an ad-hoc type scale', () => {
    const { container } = render(
      <DashboardPanel eyebrow="e" title="t">
        <p>body</p>
      </DashboardPanel>,
    )
    const section = container.querySelector('[data-slot="dashboard-panel"]')
    expect(section).toHaveClass('placard-surface')
    expect(screen.getByText('e')).toHaveClass('placard-label')
  })
})

describe('PanelEyebrow', () => {
  it('merges a caller className without dropping the placard label', () => {
    render(<PanelEyebrow className="mb-2">Top risks</PanelEyebrow>)
    const el = screen.getByText('Top risks')
    expect(el).toHaveClass('placard-label')
    expect(el).toHaveClass('mb-2')
  })
})
