import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EvaluationRow, ObligationRow } from '@/lib/environmental/client'

// One obligation's evaluation workflow (clause 9.1.2). The rules the
// database enforces are said up front: the assignee may record a result but
// another member may not; a result the API refuses is explained in plain
// words; a noncompliant result carries its nonconformity; a typo in the
// evaluation cadence never turns into "never evaluate".

const auth = vi.hoisted(() => ({ userId: 'user-member' }))
const api = vi.hoisted(() => ({
  getObligation:      vi.fn(),
  openEvaluation:     vi.fn(),
  completeEvaluation: vi.fn(),
  reviewObligation:   vi.fn(),
  uploadEvidence:     vi.fn(),
  createObligation:   vi.fn(),
  updateObligation:   vi.fn(),
}))

vi.mock('@/components/AuthProvider', () => ({ useAuth: () => ({ userId: auth.userId, profile: null }) }))
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import { ObligationDetail } from '@/app/environmental/obligations/_components/ObligationDetail'
import { ObligationForm } from '@/app/environmental/obligations/_components/ObligationForm'
import { EmsApiError } from '@/lib/environmental/client'

const obligation = {
  id: 'ob-1', facility_id: null, discipline: 'ems', title: 'Stormwater discharge monitoring reports', description: null,
  regulatory_ref: 'TPDES MSGP', cadence: 'quarterly', next_due_at: '2026-10-28', status: 'open', source: 'tenant',
  source_kind: 'permit', jurisdiction: 'state:TX', applicability_rationale: 'Industrial stormwater discharge',
  evaluation_cadence_days: 365, last_reviewed_at: null, next_review_due: '2027-06-01',
  last_evaluation_id: null, last_evaluated_at: null, last_result: null, last_nonconformity_id: null,
  open_evaluation_id: 'ev-1', open_evaluation_due: '2026-10-01', open_evaluation_assignee: 'user-member',
} satisfies ObligationRow

const openEvaluation: EvaluationRow = {
  id: 'ev-1', obligation_id: 'ob-1', scheduled_for: '2026-10-01', assigned_to: 'user-member',
  completed_at: null, evaluator_id: null, result: null, notes: null, nonconformity_id: null, created_at: '2026-09-01T00:00:00Z',
}

function detail(over: { evaluations?: EvaluationRow[] } = {}) {
  return { obligation, evaluations: over.evaluations ?? [openEvaluation], evidence: [], linkedAspects: [] }
}

beforeEach(() => {
  auth.userId = 'user-member'
  for (const fn of Object.values(api)) fn.mockReset()
  api.getObligation.mockResolvedValue(detail())
})

describe('ObligationDetail', () => {
  it('lets the assigned evaluator record the result, even as a member', async () => {
    render(<ObligationDetail tenantId="t1" obligationId="ob-1" canEdit={false} />)
    expect(await screen.findByText('Record result')).toBeInTheDocument()
    expect(screen.queryByText('Mark reviewed')).not.toBeInTheDocument()
  })

  it('tells another member who may record it, and offers no form', async () => {
    auth.userId = 'someone-else'
    render(<ObligationDetail tenantId="t1" obligationId="ob-1" canEdit={false} />)
    expect(await screen.findByText(/Only an admin or the assigned evaluator/)).toBeInTheDocument()
    expect(screen.queryByText('Record result')).not.toBeInTheDocument()
  })

  it('explains in plain words why a result was refused', async () => {
    api.completeEvaluation.mockRejectedValue(new EmsApiError('This evaluation cannot close yet.', 422, [], { gaps: ['evidence_required'] }))
    render(<ObligationDetail tenantId="t1" obligationId="ob-1" canEdit={false} />)
    fireEvent.click(await screen.findByLabelText('Compliant'))
    fireEvent.click(screen.getByText('Record result'))
    expect(await screen.findByText('Attach at least one current evidence file first.')).toBeInTheDocument()
  })

  it('opens a nonconformity with a noncompliant result', async () => {
    api.completeEvaluation.mockResolvedValue({ evaluation: {}, nonconformity: { id: 'nc-1' } })
    render(<ObligationDetail tenantId="t1" obligationId="ob-1" canEdit={false} />)
    fireEvent.click(await screen.findByLabelText('Noncompliant'))
    fireEvent.change(screen.getByLabelText('Nonconformity to open'), { target: { value: 'Q2 report filed late' } })
    fireEvent.change(screen.getByLabelText('Classification'), { target: { value: 'major' } })
    fireEvent.click(screen.getByText('Record result'))
    await waitFor(() => expect(api.completeEvaluation).toHaveBeenCalledWith('t1', 'ev-1', {
      result: 'noncompliant', notes: null, nonconformity: { title: 'Q2 report filed late', classification: 'major' },
    }))
  })

  it('lets an admin start an evaluation when none is open', async () => {
    api.getObligation.mockResolvedValue(detail({ evaluations: [] }))
    api.openEvaluation.mockResolvedValue({ evaluation: openEvaluation })
    render(<ObligationDetail tenantId="t1" obligationId="ob-1" canEdit />)
    fireEvent.click(await screen.findByText('Start an evaluation now'))
    await waitFor(() => expect(api.openEvaluation).toHaveBeenCalledWith('t1', 'ob-1'))
  })
})

describe('ObligationForm', () => {
  it('refuses a cadence that is not a whole number instead of sending "never evaluate"', async () => {
    render(<ObligationForm tenantId="t1" initial={obligation} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Evaluate compliance every (days)'), { target: { value: 'yearly' } })
    fireEvent.click(screen.getByText('Save changes'))
    expect(await screen.findByText('must be a whole number of days, or blank')).toBeInTheDocument()
    expect(api.updateObligation).not.toHaveBeenCalled()
  })

  it('keeps an unscheduled obligation unscheduled, and a contract without a jurisdiction, when editing something else', async () => {
    const contract = { ...obligation, source_kind: 'contract', jurisdiction: null, evaluation_cadence_days: null } satisfies ObligationRow
    api.updateObligation.mockResolvedValue({ obligation: contract })
    render(<ObligationForm tenantId="t1" initial={contract} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Evaluate compliance every (days)')).toHaveValue('')
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(api.updateObligation).toHaveBeenCalledWith('t1', 'ob-1',
      expect.objectContaining({ evaluation_cadence_days: null, jurisdiction: null })))
  })

  it('sends a blank cadence as "never scheduled", and composes the jurisdiction', async () => {
    api.updateObligation.mockResolvedValue({ obligation })
    render(<ObligationForm tenantId="t1" initial={obligation} onSaved={vi.fn()} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Evaluate compliance every (days)'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('State code'), { target: { value: 'ok' } })
    fireEvent.click(screen.getByText('Save changes'))
    await waitFor(() => expect(api.updateObligation).toHaveBeenCalledWith('t1', 'ob-1',
      expect.objectContaining({ evaluation_cadence_days: null, jurisdiction: 'state:OK' })))
  })
})
