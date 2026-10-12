import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ContextIssueRow, InterestedPartyRow } from '@/lib/environmental/client'

// The context register forms keep nothing from one row when the user moves
// to another, and never refuse silently. Both are easy to lose: a form that
// stays mounted keeps the last row's text, and a field error for an input
// the form has no slot for would otherwise hide every message.

const api = vi.hoisted(() => ({
  listContextIssues:     vi.fn(),
  createContextIssue:    vi.fn(),
  updateContextIssue:    vi.fn(),
  listInterestedParties: vi.fn(),
  updateInterestedParty: vi.fn(),
  listObligations:       vi.fn(),
}))

vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  ...api,
}))

import { IssuesTab } from '@/app/environmental/context/_components/IssuesTab'
import { PartiesTab } from '@/app/environmental/context/_components/PartiesTab'
import { EmsApiError } from '@/lib/environmental/client'

function issue(id: string, description: string): ContextIssueRow {
  return {
    id, discipline: 'ems', kind: 'external', description, relevance: null, effect: null,
    retired_at: null, retired_reason: null, last_reviewed_at: null, next_review_due: '2099-01-01',
  }
}

function party(id: string, name: string): InterestedPartyRow {
  return {
    id, discipline: 'ems', name, needs_expectations: `Needs of ${name}`, becomes_obligation: false, obligation_id: null,
    retired_at: null, retired_reason: null, last_reviewed_at: null, next_review_due: '2099-01-01',
  }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.listContextIssues.mockResolvedValue({ issues: [issue('A', 'Issue A text'), issue('B', 'Issue B text')] })
  api.updateContextIssue.mockResolvedValue({ issue: {} })
  api.listInterestedParties.mockResolvedValue({ parties: [party('PA', 'Party A'), party('PB', 'Party B')] })
  api.updateInterestedParty.mockResolvedValue({ party: {} })
  api.listObligations.mockResolvedValue({ obligations: [], nextOffset: null })
})

describe('moving the edit form from one row to another', () => {
  it('shows and saves the issue the user picked second, not the first one\'s text', async () => {
    render(<IssuesTab tenantId="t1" canEdit onChanged={vi.fn()} />)
    await screen.findByText('Issue A text')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    expect(screen.getByLabelText('The issue')).toHaveValue('Issue B text')
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateContextIssue).toHaveBeenCalledWith('t1', 'B',
      expect.objectContaining({ description: 'Issue B text' })))
  })

  it('does the same for interested parties', async () => {
    render(<PartiesTab tenantId="t1" canEdit onChanged={vi.fn()} />)
    await screen.findByText('Party A')
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0])
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[1])
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(api.updateInterestedParty).toHaveBeenCalledWith('t1', 'PB',
      expect.objectContaining({ name: 'Party B' })))
  })
})

describe('a refusal for a field the form has no message slot for', () => {
  it('is spelled out instead of swallowed', async () => {
    api.createContextIssue.mockRejectedValue(new EmsApiError('Invalid input', 400,
      [{ field: 'relevance', message: 'must be at most 2000 characters' }]))
    render(<IssuesTab tenantId="t1" canEdit onChanged={vi.fn()} />)
    await screen.findByText('Issue A text')
    fireEvent.click(screen.getByRole('button', { name: 'Record an issue' }))
    fireEvent.change(screen.getByLabelText('The issue'), { target: { value: 'New issue' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record issue' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('relevance must be at most 2000 characters')
  })
})
