import { vi, describe, it, expect, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { MemberRow } from '@/app/superadmin/tenants/[number]/_components/types'

// Edge tests for the new optimistic-removal logic in MembersSection.
// We mock superadminJson at the module boundary so we can stage API
// responses per test.

const { superadminJsonMock } = vi.hoisted(() => ({ superadminJsonMock: vi.fn() }))
vi.mock('@/lib/superadminFetch', () => ({
  superadminJson: (...args: unknown[]) => superadminJsonMock(...args),
}))

import { MembersSection } from '@/app/superadmin/tenants/[number]/_components/MembersSection'

const ALICE: MemberRow = {
  user_id: 'u-alice', role: 'member', joined_at: '2024-01-01T00:00:00Z',
  email: 'alice@x.com', full_name: 'Alice', must_change_password: false,
  last_sign_in_at: '2024-04-01T00:00:00Z', status: 'active',
}
const BOB: MemberRow = {
  user_id: 'u-bob', role: 'member', joined_at: '2024-02-01T00:00:00Z',
  email: 'bob@x.com', full_name: null, must_change_password: true,
  last_sign_in_at: null, status: 'invited',
}

describe('MembersSection — optimistic removal', () => {
  beforeEach(() => {
    superadminJsonMock.mockReset()
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
  })

  it('removes the row immediately on successful membership delete (before reload)', async () => {
    superadminJsonMock.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true }, error: null })
    let reloadFn = vi.fn().mockResolvedValue(undefined)

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    // Initial state: both visible, count=2
    expect(screen.getByText('Members (2)')).toBeInTheDocument()
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('bob@x.com')).toBeInTheDocument()

    // Click trash on Alice (active row → trash icon, not Cancel)
    const aliceRemove = screen.getByLabelText('Remove Alice from this tenant')
    fireEvent.click(aliceRemove)

    // Alice disappears immediately; count drops to 1; reload was called.
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
    expect(screen.getByText('Members (1)')).toBeInTheDocument()
    expect(reloadFn).toHaveBeenCalled()
  })

  it('keeps the row hidden if reload returns the user STILL present (DB delete silently failed)', async () => {
    superadminJsonMock.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true }, error: null })
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())

    // Simulate parent re-fetching and getting the SAME list (Alice still there).
    rerender(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    // Alice should STAY hidden — UI must never lie about what the click did.
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText('Members (1)')).toBeInTheDocument()
  })

  it('clears the optimistic set once the user is gone from the reloaded list', async () => {
    superadminJsonMock.mockResolvedValueOnce({ ok: true, status: 200, body: { ok: true }, error: null })
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    const { rerender } = render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)
    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())

    // Parent re-fetches and Alice is correctly absent. Then a different
    // change (e.g. Bob's role updated) re-arrives — Alice shouldn't
    // resurrect via the prop change since she's not in it.
    rerender(<MembersSection tenantNumber="0001" members={[BOB]} reload={reloadFn} />)
    expect(screen.queryByText('Alice')).not.toBeInTheDocument()
    expect(screen.getByText('Members (1)')).toBeInTheDocument()

    // If a NEW user appears (someone else invited), they should render.
    const carol: MemberRow = { ...ALICE, user_id: 'u-carol', email: 'carol@x.com', full_name: 'Carol' }
    rerender(<MembersSection tenantNumber="0001" members={[BOB, carol]} reload={reloadFn} />)
    expect(screen.getByText('Carol')).toBeInTheDocument()
    expect(screen.getByText('Members (2)')).toBeInTheDocument()
  })

  it('failed delete: row stays visible + error is shown', async () => {
    superadminJsonMock.mockResolvedValueOnce({ ok: false, status: 500, body: null, error: 'Server kaboom' })
    const reloadFn = vi.fn()

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))
    await waitFor(() => expect(screen.getByText('Server kaboom')).toBeInTheDocument())

    // Alice still there. Reload was NOT called (no successful change).
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(reloadFn).not.toHaveBeenCalled()
  })

  it('cancel-invite (rose pill on invited row) hides + reports userDeleted', async () => {
    superadminJsonMock.mockResolvedValueOnce({
      ok: true, status: 200,
      body: { ok: true, userDeleted: true },
      error: null,
    })
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    // Bob is the invited row; clicking shows "Cancel" not Remove
    expect(screen.getByLabelText(/Cancel invite for/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Cancel invite for/))

    await waitFor(() => expect(screen.queryByText('bob@x.com')).not.toBeInTheDocument())
    expect(screen.getByText('Members (1)')).toBeInTheDocument()
  })

  it('cancel-invite reports the userDelete error on the row error line', async () => {
    superadminJsonMock.mockResolvedValueOnce({
      ok: true, status: 200,
      body: { ok: true, userDeleted: false, userDeleteError: 'auth.delete fell over' },
      error: null,
    })
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    fireEvent.click(screen.getByLabelText(/Cancel invite for/))

    await waitFor(() => expect(screen.getByText(/auth\.delete fell over/)).toBeInTheDocument())
    // Bob is still hidden optimistically (membership delete succeeded)
    expect(screen.queryByText('bob@x.com')).not.toBeInTheDocument()
  })
})
