import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs, TabsList, TabsTab, TabsPanel } from '@/components/ui/tabs'

function Demo() {
  return (
    <Tabs defaultSelectedKey="a">
      <TabsList aria-label="demo tabs">
        <TabsTab id="a">A</TabsTab>
        <TabsTab id="b">B</TabsTab>
      </TabsList>
      <TabsPanel id="a">Panel A</TabsPanel>
      <TabsPanel id="b">Panel B</TabsPanel>
    </Tabs>
  )
}

describe('Tabs (React Aria migration)', () => {
  it('renders the default selected panel', () => {
    render(<Demo />)
    expect(screen.getByText('Panel A')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'A' }).getAttribute('aria-selected')).toBe('true')
  })

  it('switches panels when another tab is selected', async () => {
    render(<Demo />)
    await userEvent.click(screen.getByRole('tab', { name: 'B' }))
    expect(screen.getByText('Panel B')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'B' }).getAttribute('aria-selected')).toBe('true')
  })
})
