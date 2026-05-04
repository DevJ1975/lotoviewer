import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import type { MemberRow } from '@/app/superadmin/tenants/[number]/_components/types'

// Edge tests for the deferred-destroy + optimistic-removal logic in
// MembersSection. The API call is now deferred behind a 30-second
// undo window — tests use vi.useFakeTimers() to advance the clock
// without waiting in real time.

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

describe('MembersSection — deferred destroy + undo', () => {
  beforeEach(() => {
    superadminJsonMock.mockReset()
    // Default: any unexpected call returns a benign success so the
    // defensive unmount-commit in UndoToast doesn't unhandled-reject
    // when a test doesn't explicitly stage a response.
    superadminJsonMock.mockResolvedValue({ ok: true, status: 200, body: { ok: true }, error: null })
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('hides the row immediately on Remove + shows the undo toast', async () => {
    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={vi.fn()} />)

    expect(screen.getByText('Members (2)')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))

    // Alice gone from the list; toast visible with the undo button.
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
    expect(screen.getByText('Members (1)')).toBeInTheDocument()
    expect(screen.getByText(/Removed Alice/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument()
    // No API call yet — that's the whole point of the deferred pattern.
    expect(superadminJsonMock).not.toHaveBeenCalled()
  })

  it('Undo restores the row + never calls the API', async () => {
    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={vi.fn()} />)

    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /undo/i }))
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('Members (2)')).toBeInTheDocument()
    expect(superadminJsonMock).not.toHaveBeenCalled()
  })

  it('after 30s, the API fires + reload is called', async () => {
    superadminJsonMock.mockResolvedValue({ ok: true, status: 200, body: { ok: true }, error: null })
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())
    expect(superadminJsonMock).not.toHaveBeenCalled()

    // Advance the 30s undo window. The toast's setTimeout chain will
    // fire and commit the action.
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })

    expect(superadminJsonMock).toHaveBeenCalledWith(
      `/api/superadmin/tenants/0001/members/u-alice`,
      expect.objectContaining({ method: 'DELETE' }),
    )
    await waitFor(() => expect(reloadFn).toHaveBeenCalled())
  })

  it('committed delete that 500s rolls back the optimistic hide + shows error', async () => {
    superadminJsonMock.mockResolvedValue({ ok: false, status: 500, body: null, error: 'Server kaboom' })
    const reloadFn = vi.fn()

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    fireEvent.click(screen.getByLabelText('Remove Alice from this tenant'))
    await waitFor(() => expect(screen.queryByText('Alice')).not.toBeInTheDocument())

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })

    // Error shown, Alice restored, reload NOT called (no successful op).
    await waitFor(() => expect(screen.getByText('Server kaboom')).toBeInTheDocument())
    expect(screen.getByText('Alice')).toBeInTheDocument()
    expect(reloadFn).not.toHaveBeenCalled()
  })

  it('cancel-invite path queues the same toast (rose pill action)', async () => {
    superadminJsonMock.mockResolvedValue({ ok: true, status: 200, body: { ok: true, userDeleted: true }, error: null })
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={reloadFn} />)

    fireEvent.click(screen.getByLabelText(/Cancel invite for/))
    await waitFor(() => expect(screen.queryByText('bob@x.com')).not.toBeInTheDocument())
    expect(screen.getByText(/Cancelled invite for/)).toBeInTheDocument()

    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })

    expect(superadminJsonMock).toHaveBeenCalledWith(
      expect.stringContaining('?cancel-invite=true'),
      expect.objectContaining({ method: 'DELETE' }),
    )
    await waitFor(() => expect(reloadFn).toHaveBeenCalled())
  })

  it('cancel-invite that succeeds with userDeleteError surfaces the warning', async () => {
    superadminJsonMock.mockResolvedValue({
      ok: true, status: 200,
      body: { ok: true, userDeleted: false, userDeleteError: 'auth.delete fell over' },
      error: null,
    })
    render(<MembersSection tenantNumber="0001" members={[ALICE, BOB]} reload={vi.fn().mockResolvedValue(undefined)} />)

    fireEvent.click(screen.getByLabelText(/Cancel invite for/))
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })

    await waitFor(() => expect(screen.getByText(/auth\.delete fell over/)).toBeInTheDocument())
    expect(screen.queryByText('bob@x.com')).not.toBeInTheDocument()
  })
})

describe('MembersSection — transfer ownership', () => {
  beforeEach(() => {
    superadminJsonMock.mockReset()
    vi.spyOn(window, 'confirm').mockImplementation(() => true)
  })

  it('promoting a non-owner to owner with an existing owner uses the transfer endpoint', async () => {
    superadminJsonMock.mockResolvedValue({ ok: true, status: 200, body: { ok: true }, error: null })
    const owner: MemberRow = { ...ALICE, role: 'owner' }
    const reloadFn = vi.fn().mockResolvedValue(undefined)

    render(<MembersSection tenantNumber="0001" members={[owner, BOB]} reload={reloadFn} />)

    // Bob's role select — change to "owner"
    const bobSelect = screen.getAllByRole('combobox').find(s => (s as HTMLSelectElement).value === 'member')!
    fireEvent.change(bobSelect, { target: { value: 'owner' } })

    await waitFor(() => {
      expect(superadminJsonMock).toHaveBeenCalledWith(
        '/api/superadmin/tenants/0001/transfer-ownership',
        expect.objectContaining({
          method: 'POST',
          body:   JSON.stringify({ new_owner_user_id: BOB.user_id }),
        }),
      )
    })
  })
})
