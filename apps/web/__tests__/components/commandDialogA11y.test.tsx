import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'

// The palette's dialog shipped with aria-label/aria-description on
// <DialogContent> — which accepted only { className, children, showCloseButton }
// and had no ...props spread, so both were silently discarded. The code read as
// though the dialog were named; screen readers still announced it unnamed.
// This asserts the name actually reaches the rendered dialog.

import { CommandDialog, CommandInput, CommandList } from '@/components/ui/command'

describe('CommandDialog accessible name', () => {
  it('names the dialog with the supplied title', () => {
    render(
      <CommandDialog open onOpenChange={() => {}} title="Command palette">
        <CommandInput placeholder="Search…" />
        <CommandList />
      </CommandDialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it('carries a custom title through instead of the default', () => {
    render(
      <CommandDialog open onOpenChange={() => {}} title="Find equipment">
        <CommandInput placeholder="Search…" />
        <CommandList />
      </CommandDialog>,
    )
    expect(screen.getByRole('dialog', { name: 'Find equipment' })).toBeInTheDocument()
  })
})

// The name was fixed once already; the description was not, and looked fixed.
// `aria-description` is not a real ARIA attribute — react-aria's filterDOMProps
// allows aria-label / -labelledby / -describedby / -details and drops the rest —
// so the text never reached the DOM even after DialogContent forwarded it.
// These assert the description by its actual mechanism, association by id.
describe('CommandDialog accessible description', () => {
  it('describes the dialog with the supplied description', () => {
    render(
      <CommandDialog open onOpenChange={() => {}} description="Search for an action or page">
        <CommandInput placeholder="Search…" />
        <CommandList />
      </CommandDialog>,
    )
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Search for an action or page')
  })

  it('points aria-describedby at an element that actually exists', () => {
    render(
      <CommandDialog open onOpenChange={() => {}} description="Find anything">
        <CommandInput placeholder="Search…" />
        <CommandList />
      </CommandDialog>,
    )
    const id = screen.getByRole('dialog').getAttribute('aria-describedby')
    expect(id).toBeTruthy()
    expect(document.getElementById(id!)).toHaveTextContent('Find anything')
  })

  it('does not emit the non-standard aria-description attribute', () => {
    render(
      <CommandDialog open onOpenChange={() => {}}>
        <CommandInput placeholder="Search…" />
        <CommandList />
      </CommandDialog>,
    )
    expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-description')
  })
})
