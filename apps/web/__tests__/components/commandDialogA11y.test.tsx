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
