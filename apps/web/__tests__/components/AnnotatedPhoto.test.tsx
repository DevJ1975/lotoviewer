/**
 * AnnotatedPhoto — covers the multi-instance color regression added for
 * the isolation-photo annotation feature.
 *
 * The component renders an SVG <marker id="…"> for the arrowhead. When
 * the equipment photo and isolation photo are both on the page, they
 * MUST use distinct marker ids — otherwise the second SVG inherits the
 * first's color (browsers resolve url(#id) globally per document) and
 * the red iso arrows show up navy.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AnnotatedPhoto, AnnotationLayer } from '@/components/AnnotatedPhoto'
import type { Annotation } from '@/lib/photoAnnotations'

const sampleArrow: Annotation = {
  type:  'arrow',
  x1: 0.1, y1: 0.2,
  x2: 0.5, y2: 0.6,
  label: 'Main breaker',
}

describe('AnnotatedPhoto', () => {
  it('renders the arrow stroke in the supplied color', () => {
    const { container } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[sampleArrow]} color="#BF1414" />,
    )
    // Two stacked lines per arrow: white halo + colored stroke. We want
    // the second one (the colored one).
    const colored = container.querySelector('line[stroke="#BF1414"]')
    expect(colored).not.toBeNull()
  })

  it('paints the arrowhead marker with the supplied color', () => {
    const { container } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[sampleArrow]} color="#BF1414" />,
    )
    const marker = container.querySelector('marker > path')
    expect(marker?.getAttribute('fill')).toBe('#BF1414')
  })

  it('renders the arrow label so users see the isolation-point name', () => {
    const { getByText } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[sampleArrow]} color="#BF1414" />,
    )
    expect(getByText('Main breaker')).toBeTruthy()
  })

  it('uses unique marker ids when two instances render on the same page', () => {
    // Regression guard: a hard-coded id would let a second instance's
    // url(#…) reference resolve to the first instance's marker, leaking
    // the equipment-photo's navy color onto the iso photo's arrows.
    const { container } = render(
      <>
        <AnnotatedPhoto src="/eq.jpg"  alt="eq"  annotations={[sampleArrow]} color="#214488" />
        <AnnotatedPhoto src="/iso.jpg" alt="iso" annotations={[sampleArrow]} color="#BF1414" />
      </>,
    )
    const ids = Array.from(container.querySelectorAll('marker'))
      .map(m => m.getAttribute('id'))
      .filter((v): v is string => !!v)
    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
  })

  it('defaults to the brand-navy color when no color prop is passed', () => {
    const { container } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[sampleArrow]} />,
    )
    expect(container.querySelector('line[stroke="#214488"]')).not.toBeNull()
  })

  // ── Edge cases ─────────────────────────────────────────────────────────

  it('marker id contains no colons — useId returns ":r0:" which would break url(#…)', () => {
    // SVG/CSS treats ":" as a pseudo-class delimiter inside fragment
    // refs in some browsers; the component sanitises React's useId
    // output by replacing ":" with "_". If that sanitiser is dropped,
    // the rendered marker id contains colons and the arrowhead never
    // paints — silent failure on iPad. Catch it here.
    const { container } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[sampleArrow]} color="#BF1414" />,
    )
    const id = container.querySelector('marker')?.getAttribute('id') ?? ''
    expect(id.length).toBeGreaterThan(0)
    expect(id).not.toContain(':')
  })

  it('renders an arrow without a label — no dangling <text> node', () => {
    const unlabeled: Annotation = { type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1 }
    const { container } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[unlabeled]} color="#BF1414" />,
    )
    expect(container.querySelector('line[stroke="#BF1414"]')).not.toBeNull()
    // The only <text> in a non-label-shape render would be the arrow's
    // optional label. None means we didn't render an empty text element.
    expect(container.querySelector('text')).toBeNull()
  })

  it('renders shapes at the exact 0 and 1 boundary coordinates', () => {
    // Touch events at the photo edge can produce exactly 0 or 1 after
    // clampUnit. The renderer must accept both endpoints.
    const corner: Annotation = { type: 'arrow', x1: 0, y1: 0, x2: 1, y2: 1, label: 'Corner' }
    const { container, getByText } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[corner]} color="#BF1414" />,
    )
    const colored = container.querySelector('line[stroke="#BF1414"]') as SVGLineElement | null
    expect(colored).not.toBeNull()
    expect(colored?.getAttribute('x1')).toBe('0')
    expect(colored?.getAttribute('y2')).toBe('1')
    expect(getByText('Corner')).toBeTruthy()
  })

  it('hides the Annotate button unless editable AND onSave are both provided', () => {
    // editable without onSave makes no sense — the editor opens but
    // can't save. The component guards both conditions; verify it.
    const { queryByRole, rerender } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[]} />,
    )
    expect(queryByRole('button', { name: /annotate/i })).toBeNull()

    rerender(<AnnotatedPhoto src="/x.jpg" alt="x" annotations={[]} editable />)
    expect(queryByRole('button', { name: /annotate/i })).toBeNull()

    rerender(<AnnotatedPhoto src="/x.jpg" alt="x" annotations={[]} editable onSave={() => {}} />)
    expect(queryByRole('button', { name: /annotate/i })).not.toBeNull()
  })

  it('renders a mix of arrow and label shapes from the same array', () => {
    const mixed: Annotation[] = [
      { type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.5, label: 'Disconnect' },
      { type: 'label', x: 0.7, y: 0.8, text: 'Ground rod' },
    ]
    const { container, getByText } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={mixed} color="#BF1414" />,
    )
    expect(container.querySelectorAll('line[stroke="#BF1414"]').length).toBe(1)
    expect(getByText('Disconnect')).toBeTruthy()
    expect(getByText('Ground rod')).toBeTruthy()
  })

  it('exports AnnotationLayer as a standalone read-only overlay', () => {
    // Drives the placard photo overlays. The layer must render without
    // an enclosing AnnotatedPhoto, must be position-absolute (so it can
    // sit over an arbitrary image), and must use pointer-events-none so
    // the underlying upload click keeps working.
    const arrow: Annotation = { type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, label: 'Disconnect' }
    const { container, getByText } = render(
      <AnnotationLayer annotations={[arrow]} color="#BF1414" />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.classList.contains('absolute')).toBe(true)
    expect(svg?.classList.contains('pointer-events-none')).toBe(true)
    expect(container.querySelector('line[stroke="#BF1414"]')).not.toBeNull()
    expect(getByText('Disconnect')).toBeTruthy()
  })

  it('escapes label text — script tags must not become live nodes', () => {
    // jsonb is server-trusted but not server-sanitised; a label written
    // via SQL or an admin UI could contain '<script>'. React's default
    // escaping should keep it as text. Lock that in.
    const evil: Annotation = {
      type: 'arrow', x1: 0.1, y1: 0.2, x2: 0.4, y2: 0.5,
      label: '<script>alert(1)</script>',
    }
    const { container, getByText } = render(
      <AnnotatedPhoto src="/x.jpg" alt="x" annotations={[evil]} color="#BF1414" />,
    )
    expect(container.querySelector('script')).toBeNull()
    // Visible as plain text in the SVG — proves it was escaped, not parsed.
    expect(getByText('<script>alert(1)</script>')).toBeTruthy()
  })
})
