import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The decision screen for one read document. These pin the safety behaviour:
// nothing from a scan starts ticked, an approval cannot be sent with an invalid
// value, only an admin can decide, and a failed approval is not reported as done.

const api = vi.hoisted(() => ({ approveDocument: vi.fn(), rejectDocument: vi.fn(), getDocumentUrl: vi.fn() }))
vi.mock('@/lib/environmental/documentsClient', () => api)

import { ReviewPanel, DecidedSummary } from '@/app/environmental/documents/_components/ReviewPanel'
import type { DocumentDetail } from '@/lib/environmental/documentsClient'

const SCOPE = { tenantId: 't1', facilityId: 'f1' }

const field = (over: Record<string, unknown>) => ({
  key: 'permit_number', label: 'Permit number', value: 'F98765', confidence: 'medium',
  evidence: 'Permit No.: F98765', repaired: false, ...over,
})

function doc(over: Partial<DocumentDetail> & { fields?: unknown[]; viaOcr?: boolean } = {}): DocumentDetail {
  const { fields, viaOcr, ...rest } = over
  return {
    id: 'doc-1', file_name: 'permit.pdf', status: 'needs_review', doc_type: 'air_permit',
    doc_type_confidence: 'high', overall_confidence: 'medium', via_ocr: viaOcr ?? false,
    error: null, reviewed_at: null, created_at: '2026-10-07T00:00:00Z', reviewed_fields: [], obligation_ids: [],
    extraction: { notes: 'Check every value.', fields: fields ?? [
      field({}),
      field({ key: 'expiration_date', label: 'Expiration date', value: '2027-04-30', confidence: 'high', evidence: 'Expires: April 30, 2027' }),
      field({ key: 'issue_date', label: 'Issue date', value: '2024-04-01', confidence: 'low', evidence: 'Issued 04/01/2024' }),
    ] },
    ...rest,
  } as DocumentDetail
}

function renderPanel(d: DocumentDetail, opts: { canDecide?: boolean } = {}) {
  const onDecided = vi.fn()
  render(<ReviewPanel doc={d} scope={SCOPE} canDecide={opts.canDecide ?? true} onDecided={onDecided} />)
  return { onDecided }
}

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement
const approveButton = () => screen.getByRole('button', { name: /^approve/i }) as HTMLButtonElement

beforeEach(() => {
  vi.clearAllMocks()
  api.approveDocument.mockResolvedValue({ obligation_ids: ['ob-1'] })
  api.rejectDocument.mockResolvedValue(undefined)
})

describe('ReviewPanel — what starts ticked', () => {
  it('ticks confident fields and leaves an unsure one for the reviewer', () => {
    renderPanel(doc())
    expect(checkbox(/confirm permit number/i).checked).toBe(true)
    expect(checkbox(/confirm expiration date/i).checked).toBe(true)
    expect(checkbox(/confirm issue date/i).checked).toBe(false)
    expect(approveButton()).toHaveTextContent('Approve 2 fields')
  })

  it('ticks NOTHING from a scan and warns that digits can be misread', () => {
    renderPanel(doc({ viaOcr: true }))
    expect(screen.getByRole('alert')).toHaveTextContent(/read from a scan/i)
    const fieldBoxes = screen.getAllByRole('checkbox', { name: /^confirm /i })
    expect(fieldBoxes).toHaveLength(3)
    for (const c of fieldBoxes) expect((c as HTMLInputElement).checked).toBe(false)
    expect(approveButton()).toBeDisabled()
  })

  it('shows the text each value came from, so it can be checked against the original', () => {
    renderPanel(doc())
    expect(screen.getByText(/Expires: April 30, 2027/)).toBeInTheDocument()
  })

  it('says so when nothing was found, instead of an empty form', () => {
    renderPanel(doc({ fields: [] }))
    expect(screen.getByText(/No identifiers or dates were found/i)).toBeInTheDocument()
    expect(approveButton()).toBeDisabled()
  })
})

describe('ReviewPanel — approving', () => {
  it('sends the ticked fields by position with their current values, then reports it decided', async () => {
    const { onDecided } = renderPanel(doc())
    await userEvent.click(approveButton())
    await waitFor(() => expect(onDecided).toHaveBeenCalledTimes(1))
    expect(api.approveDocument).toHaveBeenCalledWith(SCOPE, 'doc-1', {
      accepted: [{ index: 0, value: 'F98765' }, { index: 1, value: '2027-04-30' }],
      create_obligations: true,
    })
  })

  it('sends a corrected value, not the one that was read', async () => {
    renderPanel(doc())
    fireEvent.change(screen.getByLabelText('Permit number'), { target: { value: 'F98766' } })
    await userEvent.click(approveButton())
    await waitFor(() => expect(api.approveDocument).toHaveBeenCalled())
    expect(api.approveDocument.mock.calls[0][2].accepted[0]).toEqual({ index: 0, value: 'F98766' })
  })

  it('cannot be sent with a blank value', async () => {
    renderPanel(doc())
    fireEvent.change(screen.getByLabelText('Permit number'), { target: { value: '   ' } })
    expect(approveButton()).toBeDisabled()
    expect(screen.getByText(/needs a value/i)).toBeInTheDocument()
    await userEvent.click(approveButton())
    expect(api.approveDocument).not.toHaveBeenCalled()
  })

  it('previews the calendar entry an approval would create, and drops it when switched off', async () => {
    renderPanel(doc())
    expect(screen.getByText(/Air permit F98765 expires, due 2027-04-30/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /add confirmed expiry and renewal dates/i }))
    expect(screen.queryByText(/will be added to the compliance calendar/i)).not.toBeInTheDocument()
    await userEvent.click(approveButton())
    await waitFor(() => expect(api.approveDocument).toHaveBeenCalled())
    expect(api.approveDocument.mock.calls[0][2].create_obligations).toBe(false)
  })

  it('does not report success when the approval fails', async () => {
    api.approveDocument.mockRejectedValue(new Error('This document was just decided by someone else.'))
    const { onDecided } = renderPanel(doc())
    await userEvent.click(approveButton())
    expect(await screen.findByText(/just decided by someone else/i)).toBeInTheDocument()
    expect(onDecided).not.toHaveBeenCalled()
  })

  it('rejects a reading', async () => {
    const { onDecided } = renderPanel(doc())
    await userEvent.click(screen.getByRole('button', { name: /reject reading/i }))
    await waitFor(() => expect(onDecided).toHaveBeenCalled())
    expect(api.rejectDocument).toHaveBeenCalledWith(SCOPE, 'doc-1')
  })
})

describe('ReviewPanel — who may decide', () => {
  it('lets a non-admin read the proposal but not act on it', () => {
    renderPanel(doc(), { canDecide: false })
    expect(screen.queryByRole('button', { name: /^approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject reading/i })).not.toBeInTheDocument()
    expect(screen.getByText(/tenant admin approves or rejects/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Permit number')).toBeDisabled()
    expect(checkbox(/confirm permit number/i)).toBeDisabled()
  })
})

describe('ReviewPanel — the original', () => {
  it('opens the original document from a signed link, without leaking the opener', async () => {
    api.getDocumentUrl.mockResolvedValue('https://signed.example/doc.pdf')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderPanel(doc())
    await userEvent.click(screen.getByRole('button', { name: /view original/i }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://signed.example/doc.pdf', '_blank', 'noopener,noreferrer'))
  })
})

describe('ReviewPanel — an unusable proposal', () => {
  it('says so rather than rendering a broken form', () => {
    renderPanel(doc({ extraction: null }))
    expect(screen.getByText(/no readable proposal/i)).toBeInTheDocument()
  })
})

describe('DecidedSummary', () => {
  it('lists what was confirmed, marks a correction, and points at the calendar entries', () => {
    render(<DecidedSummary doc={doc({
      status: 'approved', obligation_ids: ['a', 'b'],
      reviewed_fields: [
        { key: 'permit_number', label: 'Permit number', value: 'F98766', edited: true },
        { key: 'expiration_date', label: 'Expiration date', value: '2027-04-30', edited: false },
      ],
    })} />)
    expect(screen.getByText('F98766')).toBeInTheDocument()
    expect(screen.getByText(/corrected by reviewer/i)).toBeInTheDocument()
    expect(screen.getByText(/2 entries were/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /compliance calendar/i })).toHaveAttribute('href', '/admin/compliance/calendar')
  })

  it('says a rejected reading filed nothing', () => {
    render(<DecidedSummary doc={doc({ status: 'rejected' })} />)
    expect(screen.getByText(/Nothing was filed/i)).toBeInTheDocument()
  })
})
