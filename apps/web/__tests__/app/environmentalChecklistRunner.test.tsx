import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// The checklist runner is the screen used in the field, so these tests drive it the
// way a person would: answer, see what blocks submitting, sign, submit.

const getRun = vi.fn()
const submitRun = vi.fn()
vi.mock('@/lib/environmental/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/client')>('@/lib/environmental/client')
  return { ...actual, getRun: (...a: unknown[]) => getRun(...a), submitRun: (...a: unknown[]) => submitRun(...a) }
})
// Stable objects, as the real hooks return (the scope is memoized there): a new object on
// every render would re-run the page's load effect and wipe what the test just typed.
const SCOPE = { tenantId: 'tenant-1', facilityId: 'fac-1' }
const ENV = { scope: SCOPE, ready: true, canAdmin: false, facilityId: 'fac-1', facilityName: 'Plant 1' }
const AUTH = { profile: { full_name: 'Pat Inspector' } }
vi.mock('@/lib/environmental/useEnvironmental', () => ({ useEnvironmentalScope: () => ENV }))
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => AUTH }))
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'run-1' }) }))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => <header><h1>{title}</h1><p>{description}</p></header>,
}))
vi.mock('@/components/SignaturePad', () => ({ default: () => <canvas data-testid="pad" /> }))
vi.mock('@/lib/environmental/evidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/evidence')>('@/lib/environmental/evidence')
  return { ...actual, uploadEvidence: vi.fn(), evidenceUrl: vi.fn().mockResolvedValue(null) }
})

import ChecklistRunPage from '@/app/environmental/compliance/checklists/[id]/page'

const item = (over: Record<string, unknown>) => ({
  section: 'Observations', required: true, critical: false, guidance: null, citations: [], clause_ref: null, unit: null, min: null, max: null, ...over,
})

const run = (over: Partial<{ status: 'in_progress' | 'submitted'; responses: unknown[]; result: 'pass' | 'fail' | null }> = {}) => ({
  inspection: { id: 'run-1', title: 'Visual: Outfall 001', status: over.status ?? 'in_progress', result: over.result ?? null, score: null, max_score: null, facility_id: 'fac-1' },
  run: { obligation_id: null, occurrence_at: null, attested: false, signature: over.status === 'submitted' ? { name: 'Sam Signer', signed_at: '2026-09-30T12:00:00Z' } : null },
  template_name: 'Outfall visual assessment',
  subject_label: 'Outfall 001',
  items: [
    item({ id: 'sheen', prompt: 'Is there an oil sheen?', item_type: 'pass_fail_na', critical: true, clause_ref: '9.1.1', guidance: 'Look at the surface of the water.', citations: [{ ref: 'IGP §XI.A', verify: 'confirm current section number' }] }),
    item({ id: 'ph', prompt: 'Measure the pH', item_type: 'numeric', section: 'Samples', unit: 'pH', min: 6, max: 9 }),
    item({ id: 'notes', prompt: 'Anything else?', item_type: 'text', section: 'Samples', required: false }),
  ],
  responses: over.responses ?? [],
})

const draftKey = 'env-checklist-draft:run-1'

beforeEach(() => {
  getRun.mockReset(); submitRun.mockReset()
  window.localStorage.clear()
})

async function open(r = run()) {
  getRun.mockResolvedValue(r)
  render(<ChecklistRunPage />)
  await screen.findByRole('heading', { name: 'Outfall visual assessment' })
}

describe('running a checklist', () => {
  it('shows the questions by section with the guidance, citations and what needs checking', async () => {
    await open()
    // The question is listed again under "still open", so find it by its own group.
    expect(screen.getByRole('group', { name: 'Answer: Is there an oil sheen?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Samples' })).toBeInTheDocument()
    expect(screen.getByText(/Critical/)).toBeInTheDocument()
    expect(screen.getByText(/ISO 14001 9\.1\.1/)).toBeInTheDocument()
    expect(screen.getByText('Look at the surface of the water.')).toBeInTheDocument()
    expect(screen.getByText(/confirm current section number/)).toBeInTheDocument()
    expect(screen.getByText('0 of 2 required questions answered.')).toBeInTheDocument()
  })

  it('blocks submitting while required questions are open, names them, and does not submit', async () => {
    const user = userEvent.setup()
    await open()
    const submit = screen.getByRole('button', { name: 'Submit checklist' })
    expect(submit).toBeDisabled()
    expect(screen.getByText(/2 required questions are still open/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Measure the pH' })).toBeInTheDocument()
    await user.click(submit)
    expect(submitRun).not.toHaveBeenCalled()
  })

  it('judges a reading against its limits as it is typed', async () => {
    const user = userEvent.setup()
    await open()
    const ph = screen.getByLabelText('Reading: Measure the pH')
    await user.type(ph, '7.2')
    expect(screen.getByText('Within limits')).toBeInTheDocument()
    await user.clear(ph)
    await user.type(ph, '9.8')
    expect(screen.getByText(/Outside limits: will be recorded as a failure/)).toBeInTheDocument()
    expect(screen.getByText('Limit: 6 to 9 pH')).toBeInTheDocument()
  })

  it('asks what was seen when an item fails, so the finding says something', async () => {
    const user = userEvent.setup()
    await open()
    expect(screen.queryByText(/What did you see/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fail' }))
    expect(screen.getByText(/What did you see/)).toBeInTheDocument()
  })

  it('needs the attestation and a name before it will submit, and says which is missing', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await user.type(screen.getByLabelText('Reading: Measure the pH'), '7')
    const submit = screen.getByRole('button', { name: 'Submit checklist' })
    expect(submit).toBeDisabled()
    expect(screen.getByText('Confirm the statement above to submit.')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    expect(submit).toBeEnabled()
    await user.clear(screen.getByLabelText(/^Your name/))
    expect(submit).toBeDisabled()
    expect(screen.getByText('Type your name to submit.')).toBeInTheDocument()
  })

  it('submits exactly what was answered, signs with the name given, and reports the outcome', async () => {
    const user = userEvent.setup()
    submitRun.mockResolvedValue({ result: 'fail', score: 0, maxScore: 1, pct: 0, findingsRaised: 1, completedObligation: true })
    await open()
    await user.click(screen.getByRole('button', { name: 'Fail' }))
    await user.type(screen.getByLabelText(/What did you see/), '  Oil sheen near the weir  ')
    await user.type(screen.getByLabelText('Reading: Measure the pH'), '7.4')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Submit checklist' }))

    await waitFor(() => expect(submitRun).toHaveBeenCalledTimes(1))
    expect(submitRun).toHaveBeenCalledWith({ tenantId: 'tenant-1', facilityId: 'fac-1' }, 'run-1', {
      attested: true,
      signature_name: 'Pat Inspector',
      answers: [
        { item_id: 'sheen', result: 'fail', note: 'Oil sheen near the weir', evidence_id: null },
        { item_id: 'ph', value: 7.4, note: null, evidence_id: null },
      ],
    })
    expect(await screen.findByText('Submitted: some items failed')).toBeInTheDocument()
    expect(screen.getByText(/1 finding was raised/)).toBeInTheDocument()
    expect(screen.getByText(/calendar deadline this satisfies was completed/)).toBeInTheDocument()
    expect(window.localStorage.getItem(draftKey)).toBeNull()
  })

  it('shows every problem the server reports and keeps the answers', async () => {
    const user = userEvent.setup()
    const { ApiError } = await import('@/lib/environmental/client')
    submitRun.mockRejectedValue(new ApiError('Some required questions are still unanswered.', 400, 'missing_required', ['Some required questions are still unanswered.']))
    await open()
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await user.type(screen.getByLabelText('Reading: Measure the pH'), '7')
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Submit checklist' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Some required questions are still unanswered.')
    expect(screen.getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('keeping answers on the device', () => {
  it('saves a draft as answers are given', async () => {
    const user = userEvent.setup()
    await open()
    await user.click(screen.getByRole('button', { name: 'Pass' }))
    await waitFor(() => {
      const stored = JSON.parse(window.localStorage.getItem(draftKey) ?? '{}')
      expect(stored.answers.sheen.result).toBe('pass')
    })
  })

  it('restores a draft after a reload, including the typed name', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify({
      answers: { sheen: { result: 'pass', value: '', evidencePath: null, note: '' }, ph: { result: null, value: '7.1', evidencePath: null, note: '' } },
      signatureName: 'Draft Name',
    }))
    await open()
    expect(screen.getByRole('button', { name: 'Pass' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Reading: Measure the pH')).toHaveValue(7.1)
    expect(screen.getByLabelText(/^Your name/)).toHaveValue('Draft Name')
    expect(screen.getByText('2 of 2 required questions answered.')).toBeInTheDocument()
  })

  it('ignores a damaged draft instead of failing', async () => {
    window.localStorage.setItem(draftKey, '{not json')
    await open()
    expect(screen.getByText('0 of 2 required questions answered.')).toBeInTheDocument()
  })
})

describe('a submitted checklist', () => {
  it('opens read-only as a record, with who signed it, and offers no way to change it', async () => {
    await open(run({
      status: 'submitted', result: 'fail',
      responses: [
        { item_id: 'sheen', value: null, result: 'fail', evidence_id: null, note: 'Oil sheen' },
        { item_id: 'ph', value: 7.2, result: 'pass', evidence_id: null, note: null },
      ],
    }))
    expect(screen.getByText('Submitted by Sam Signer.')).toBeInTheDocument()
    expect(screen.getByText('Findings raised')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fail' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Fail' })).toBeDisabled()
    expect(screen.getByLabelText('Reading: Measure the pH')).toHaveValue(7.2)
    expect(screen.getByLabelText('Reading: Measure the pH')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Submit checklist' })).not.toBeInTheDocument()
  })
})

describe('when the run cannot be loaded', () => {
  it('says what went wrong', async () => {
    getRun.mockRejectedValue(new Error('That record no longer exists.'))
    render(<ChecklistRunPage />)
    const alert = await screen.findByRole('alert')
    expect(within(alert).getByText('That record no longer exists.')).toBeInTheDocument()
  })
})
