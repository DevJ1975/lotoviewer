import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent, screen } from '@testing-library/react'
import Dropzone from '@/components/ui/Dropzone'

// Interaction tests for the Dropzone — covers the bits the pure
// validator can't see: drag-depth highlight tracking, disabled state,
// multi-file drop guard, same-file re-pick (the regression I fixed
// after the chemicals/[id] refactor lost the manual e.target.value
// reset), and the X button reset.

function makeFile(opts: { name: string; type?: string; size?: number }): File {
  const blob = new Blob([new Uint8Array(opts.size ?? 1024)], { type: opts.type ?? '' })
  return new File([blob], opts.name, { type: opts.type ?? '' })
}

// jsdom doesn't ship a working DataTransfer; fake just enough surface
// for the dropzone's handlers.
function fakeDataTransfer(files: File[]): DataTransfer {
  return { files: files as unknown as FileList } as unknown as DataTransfer
}

describe('Dropzone — pick + reset', () => {
  it('calls onFileSelected with a valid dropped file', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone file={null} onFileSelected={onFile} onValidationError={onErr} />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([makeFile({ name: 'a.pdf', type: 'application/pdf' })]) })
    expect(onFile).toHaveBeenCalledTimes(1)
    expect((onFile.mock.calls[0][0] as File).name).toBe('a.pdf')
    expect(onErr).not.toHaveBeenCalled()
  })

  it('rejects an oversized file and surfaces the reason via onValidationError', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone file={null} onFileSelected={onFile} onValidationError={onErr} />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([makeFile({ name: 'big.pdf', type: 'application/pdf', size: 30 * 1024 * 1024 })]) })
    expect(onErr).toHaveBeenCalledWith(expect.stringMatching(/over the 25 MB cap/))
    // onFileSelected fires with null on rejection so the parent clears
    // any stale selection.
    expect(onFile).toHaveBeenLastCalledWith(null)
  })

  it('rejects a multi-file drop with a clear message', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone file={null} onFileSelected={onFile} onValidationError={onErr} />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([
      makeFile({ name: 'a.pdf', type: 'application/pdf' }),
      makeFile({ name: 'b.pdf', type: 'application/pdf' }),
    ]) })
    expect(onErr).toHaveBeenCalledWith(expect.stringMatching(/one file at a time/i))
    expect(onFile).not.toHaveBeenCalled()
  })

  it('ignores a drop with zero files (e.g. a text drag)', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone file={null} onFileSelected={onFile} onValidationError={onErr} />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([]) })
    expect(onFile).not.toHaveBeenCalled()
    expect(onErr).not.toHaveBeenCalled()
  })

  it('clears the underlying input on every onChange so the SAME file picks again', () => {
    // Regression for the chemicals/[id] refactor: the original code
    // reset e.target.value after every pick so re-uploading the same
    // SDS revision worked. The Dropzone now owns that reset.
    const onFile = vi.fn()
    const { container } = render(<Dropzone file={null} onFileSelected={onFile} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement

    const f = makeFile({ name: 'a.pdf', type: 'application/pdf' })
    Object.defineProperty(input, 'files', { value: [f], configurable: true })
    fireEvent.change(input)
    expect(onFile).toHaveBeenCalledTimes(1)
    // Critical: input value must be cleared so the next pick of the
    // same file fires onChange instead of being deduplicated.
    expect(input.value).toBe('')
  })

  it('renders the selected-file chip with name + size + remove button', () => {
    const onFile = vi.fn()
    const f = makeFile({ name: 'reg.pdf', type: 'application/pdf', size: 2 * 1024 * 1024 })
    render(<Dropzone file={f} onFileSelected={onFile} />)
    expect(screen.getByText('reg.pdf')).toBeInTheDocument()
    expect(screen.getByText(/2\.0 MB/)).toBeInTheDocument()
    expect(screen.getByLabelText('Remove file')).toBeInTheDocument()
  })

  it('clears the file when the X button is clicked', () => {
    const onFile = vi.fn()
    const f = makeFile({ name: 'reg.pdf', type: 'application/pdf' })
    render(<Dropzone file={f} onFileSelected={onFile} />)
    fireEvent.click(screen.getByLabelText('Remove file'))
    expect(onFile).toHaveBeenLastCalledWith(null)
  })
})

describe('Dropzone — drag highlight depth tracking', () => {
  it('highlights on dragenter and stays highlighted across child dragenter/leave', () => {
    const { container } = render(<Dropzone file={null} onFileSelected={vi.fn()} />)
    const label = container.querySelector('label')!

    // Initial: no indigo highlight class
    expect(label.className).not.toContain('border-indigo-500')

    // Dragenter on the label itself
    fireEvent.dragEnter(label, { dataTransfer: fakeDataTransfer([]) })
    expect(label.className).toContain('border-indigo-500')

    // Dragenter on a child (any descendant span/div) bubbles up — depth
    // increments. Then dragleave on the child decrements but the label
    // is still entered, so the highlight should persist. The original
    // implementation without depth tracking would flicker off here.
    fireEvent.dragEnter(label, { dataTransfer: fakeDataTransfer([]) })
    fireEvent.dragLeave(label, { dataTransfer: fakeDataTransfer([]) })
    expect(label.className).toContain('border-indigo-500')

    // Final dragleave — back to baseline
    fireEvent.dragLeave(label, { dataTransfer: fakeDataTransfer([]) })
    expect(label.className).not.toContain('border-indigo-500')
  })

  it('clears highlight after a drop', () => {
    const { container } = render(<Dropzone file={null} onFileSelected={vi.fn()} />)
    const label = container.querySelector('label')!
    fireEvent.dragEnter(label, { dataTransfer: fakeDataTransfer([]) })
    expect(label.className).toContain('border-indigo-500')
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([makeFile({ name: 'a.pdf', type: 'application/pdf' })]) })
    expect(label.className).not.toContain('border-indigo-500')
  })
})

describe('Dropzone — disabled', () => {
  it('shows the disabled cursor + opacity when disabled', () => {
    const { container } = render(<Dropzone file={null} onFileSelected={vi.fn()} disabled />)
    const label = container.querySelector('label')!
    expect(label.className).toContain('cursor-not-allowed')
    expect(label.className).toContain('opacity-60')
  })

  it('disables the underlying file input when disabled', () => {
    const { container } = render(<Dropzone file={null} onFileSelected={vi.fn()} disabled />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.disabled).toBe(true)
  })

  it('ignores drops while disabled', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone file={null} onFileSelected={onFile} onValidationError={onErr} disabled />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([makeFile({ name: 'a.pdf', type: 'application/pdf' })]) })
    expect(onFile).not.toHaveBeenCalled()
    expect(onErr).not.toHaveBeenCalled()
  })
})

describe('Dropzone — custom allowlist + maxBytes', () => {
  it('honours a PDF-only allowlist (chemical SDS use case)', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone
        file={null}
        onFileSelected={onFile}
        onValidationError={onErr}
        acceptedMimes={new Set(['application/pdf'])}
        acceptedExts={new Set(['pdf'])}
      />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([makeFile({ name: 'note.md', type: 'text/markdown' })]) })
    expect(onFile).toHaveBeenLastCalledWith(null)
    expect(onErr).toHaveBeenCalled()
  })

  it('honours a custom maxBytes', () => {
    const onFile = vi.fn()
    const onErr  = vi.fn()
    const { container } = render(
      <Dropzone
        file={null}
        onFileSelected={onFile}
        onValidationError={onErr}
        maxBytes={1024}
      />,
    )
    const label = container.querySelector('label')!
    fireEvent.drop(label, { dataTransfer: fakeDataTransfer([makeFile({ name: 'a.pdf', type: 'application/pdf', size: 2048 })]) })
    expect(onErr).toHaveBeenCalledWith(expect.stringMatching(/over the 0 MB cap/))
  })
})

describe('Dropzone — accessibility', () => {
  it('uses sr-only on the underlying input (so it stays in tab order)', () => {
    const { container } = render(<Dropzone file={null} onFileSelected={vi.fn()} />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(input.className).toContain('sr-only')
    expect(input.style.display).not.toBe('none')
  })

  it('respects a custom inputId so two dropzones can coexist on a page', () => {
    const { container, rerender } = render(
      <Dropzone file={null} onFileSelected={vi.fn()} inputId="zone-1" />,
    )
    expect(container.querySelector('#zone-1')).toBeTruthy()
    rerender(<Dropzone file={null} onFileSelected={vi.fn()} inputId="zone-2" />)
    expect(container.querySelector('#zone-2')).toBeTruthy()
  })
})
