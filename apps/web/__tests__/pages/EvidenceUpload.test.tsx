import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EvidenceRow } from '@/lib/environmental/client'

// The upload every evidence-bearing record shares. What matters to a user: the
// file goes to the right record, a wrong file is replaced (with a reason) and
// never deleted, an export-controlled file is marked as one, and a file too
// large for storage is refused before anything is sent.

const api = vi.hoisted(() => ({ uploadEvidence: vi.fn(), downloadEvidence: vi.fn() }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import { EvidenceList, EvidenceUpload } from '@/app/environmental/_components/EvidenceUpload'

const evidence = (over: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id: 'e1', subject_id: 'permit-1', kind: 'document', file_name: 'permit-2026.pdf', mime_type: 'application/pdf',
  file_size_bytes: 1000, sha256: 'a'.repeat(64), uploaded_by: 'u1', uploaded_at: '2026-10-01T00:00:00Z',
  superseded_by: null, superseded_at: null, superseded_reason: null, export_controlled: false, ...over,
})

const pick = (file: File) => fireEvent.change(screen.getByLabelText('Evidence file'), { target: { files: [file] } })
const pdf = (bytes = 10, name = 'new.pdf') => new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })

beforeEach(() => { for (const fn of Object.values(api)) fn.mockReset() })

describe('EvidenceUpload', () => {
  it('attaches the file to the record it is given', async () => {
    api.uploadEvidence.mockResolvedValue({ evidence: evidence() })
    const onUploaded = vi.fn()
    render(<EvidenceUpload tenantId="t1" subjectType="environmental_permit" subjectId="permit-1" current={[]} onUploaded={onUploaded} />)
    pick(pdf())
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(onUploaded).toHaveBeenCalled())
    expect(api.uploadEvidence).toHaveBeenCalledWith('t1', expect.objectContaining({
      subjectType: 'environmental_permit', subjectId: 'permit-1', kind: 'document', exportControlled: false, supersedes: undefined,
    }))
  })

  it('marks an export-controlled file as one', async () => {
    api.uploadEvidence.mockResolvedValue({ evidence: evidence() })
    render(<EvidenceUpload tenantId="t1" subjectType="ms_change_impact" subjectId="i1" current={[]} onUploaded={() => {}} />)
    pick(pdf())
    fireEvent.click(screen.getByLabelText(/Export-controlled/))
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    await waitFor(() => expect(api.uploadEvidence).toHaveBeenCalledWith('t1', expect.objectContaining({ exportControlled: true })))
  })

  it('needs a reason before it replaces a file, and never offers to delete one', () => {
    render(<EvidenceUpload tenantId="t1" subjectType="environmental_permit" subjectId="permit-1" current={[evidence()]} onUploaded={() => {}} />)
    pick(pdf())
    fireEvent.change(screen.getByLabelText('Replaces (optional)'), { target: { value: 'e1' } })
    expect(screen.getByRole('button', { name: 'Attach' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Why the earlier file is replaced'), { target: { value: 'Scanned the wrong page' } })
    expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled()
    expect(screen.queryByText(/delete/i, { selector: 'button' })).not.toBeInTheDocument()
  })

  it('refuses a file over the limit without sending anything', () => {
    render(<EvidenceUpload tenantId="t1" subjectType="environmental_permit" subjectId="permit-1" current={[]} onUploaded={() => {}} />)
    pick(pdf(26 * 1024 * 1024))
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(screen.getByRole('alert')).toHaveTextContent('limited to 25 MB')
    expect(api.uploadEvidence).not.toHaveBeenCalled()
  })

  it('shows the API\'s refusal and keeps the chosen file', async () => {
    api.uploadEvidence.mockRejectedValue(new Error('This permit is retired, so its documents can no longer change.'))
    const onUploaded = vi.fn()
    render(<EvidenceUpload tenantId="t1" subjectType="environmental_permit" subjectId="permit-1" current={[]} onUploaded={onUploaded} />)
    pick(pdf())
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('is retired')
    expect(onUploaded).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Attach' })).toBeEnabled()
  })
})

describe('EvidenceList', () => {
  it('flags an export-controlled file, and strikes a replaced one with its reason', () => {
    render(<EvidenceList tenantId="t1" evidence={[
      evidence({ id: 'e1', file_name: 'old.pdf', superseded_by: 'e2', superseded_reason: 'Wrong page' }),
      evidence({ id: 'e2', file_name: 'new.pdf', export_controlled: true }),
    ]} />)
    expect(screen.getByText(/replaced: Wrong page/)).toBeInTheDocument()
    expect(screen.getByText(/export-controlled/)).toBeInTheDocument()
  })

  it('says so when no evidence is filed, and shows a refused download', async () => {
    const { rerender } = render(<EvidenceList tenantId="t1" evidence={[]} />)
    expect(screen.getByText('No evidence filed.')).toBeInTheDocument()
    api.downloadEvidence.mockRejectedValue(new Error('This file is export-controlled, so only owners and admins can download it.'))
    rerender(<EvidenceList tenantId="t1" evidence={[evidence({ export_controlled: true })]} />)
    fireEvent.click(screen.getByText('permit-2026.pdf'))
    expect(await screen.findByRole('alert')).toHaveTextContent('only owners and admins')
  })
})
