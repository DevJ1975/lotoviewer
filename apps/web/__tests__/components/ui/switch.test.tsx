import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Switch } from '@/components/ui/switch'

describe('Switch (React Aria migration)', () => {
  it('exposes a switch role reflecting the checked state', () => {
    render(<Switch checked onChange={() => {}} ariaLabel="Notify" />)
    const sw = screen.getByRole('switch') as HTMLInputElement
    expect(sw.checked).toBe(true)
  })

  it('calls onChange with the toggled boolean when activated', async () => {
    const onChange = vi.fn()
    render(<Switch checked={false} onChange={onChange} ariaLabel="Notify" />)
    await userEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('forwards the id', () => {
    render(<Switch checked={false} onChange={() => {}} id="sw-1" ariaLabel="Notify" />)
    expect(screen.getByRole('switch').id).toBe('sw-1')
  })
})
