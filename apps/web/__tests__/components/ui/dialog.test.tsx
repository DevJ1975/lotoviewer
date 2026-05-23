import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'

function Harness({ onOpenChange }: { onOpenChange?: (o: boolean) => void }) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); onOpenChange?.(o) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Welcome aboard</DialogTitle>
          <DialogDescription>Some description</DialogDescription>
        </DialogHeader>
        <p>Body content</p>
      </DialogContent>
    </Dialog>
  )
}

describe('Dialog (React Aria migration)', () => {
  it('renders content and exposes an accessible dialog name when open', () => {
    render(<Harness />)
    expect(screen.getByText('Body content')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: 'Welcome aboard' })).toBeTruthy()
  })

  it('fires onOpenChange(false) and closes when the close button is pressed', async () => {
    const onOpenChange = vi.fn()
    render(<Harness onOpenChange={onOpenChange} />)
    await userEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(screen.queryByText('Body content')).toBeNull()
  })

  it('renders nothing when controlled open is false', () => {
    render(
      <Dialog open={false} onOpenChange={() => {}}>
        <DialogContent><p>Hidden body</p></DialogContent>
      </Dialog>,
    )
    expect(screen.queryByText('Hidden body')).toBeNull()
  })
})
