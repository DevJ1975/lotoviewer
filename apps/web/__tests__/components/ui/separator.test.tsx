import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Separator } from '@/components/ui/separator'

describe('Separator (React Aria migration)', () => {
  it('renders an accessible separator with horizontal sizing by default', () => {
    render(<Separator />)
    const sep = screen.getByRole('separator')
    expect(sep.className).toContain('h-px')
    expect(sep.className).toContain('w-full')
  })

  it('applies vertical sizing when orientation is vertical', () => {
    render(<Separator orientation="vertical" />)
    expect(screen.getByRole('separator').className).toContain('w-px')
  })
})
