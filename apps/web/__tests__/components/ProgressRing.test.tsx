import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProgressRing from '@/components/ProgressRing'

describe('ProgressRing', () => {
  it('displays the rounded percentage', () => {
    render(<ProgressRing value={72.6} />)
    expect(screen.getByText('73%')).toBeInTheDocument()
  })

  it('displays 0% for zero value', () => {
    render(<ProgressRing value={0} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('displays 100% for full value', () => {
    render(<ProgressRing value={100} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('clamps negative value to 0%', () => {
    render(<ProgressRing value={-10} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('clamps value above 100 to 100%', () => {
    render(<ProgressRing value={150} />)
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('renders 0% for NaN value without crashing', () => {
    render(<ProgressRing value={NaN} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
  })

  it('renders the label when provided', () => {
    render(<ProgressRing value={50} label="Overall Complete" />)
    expect(screen.getByText('Overall Complete')).toBeInTheDocument()
  })

  it('renders the sublabel when provided', () => {
    render(<ProgressRing value={50} sublabel="247 of 701" />)
    expect(screen.getByText('247 of 701')).toBeInTheDocument()
  })

  it('does not render label or sublabel spans when omitted', () => {
    const { container } = render(<ProgressRing value={50} />)
    // Only the percentage span should exist inside the overlay div
    const overlay = container.querySelector('.absolute')!
    expect(overlay.children).toHaveLength(1)
  })

  it('renders two SVG circles', () => {
    const { container } = render(<ProgressRing value={60} />)
    expect(container.querySelectorAll('circle')).toHaveLength(2)
  })

  it('uses green stroke for value >= 80', () => {
    const { container } = render(<ProgressRing value={80} />)
    const circles = container.querySelectorAll('circle')
    const progressCircle = circles[1]
    expect(progressCircle.getAttribute('stroke')).toBe('#22c55e')
  })

  it('uses amber stroke for value >= 50 and < 80', () => {
    const { container } = render(<ProgressRing value={65} />)
    const circles = container.querySelectorAll('circle')
    expect(circles[1].getAttribute('stroke')).toBe('#f59e0b')
  })

  it('uses red stroke for value < 50', () => {
    const { container } = render(<ProgressRing value={49} />)
    const circles = container.querySelectorAll('circle')
    expect(circles[1].getAttribute('stroke')).toBe('#ef4444')
  })
})
