/**
 * UX regression specs for PlacardPhotoSlot — protect against two bugs
 * that shipped earlier:
 *
 * 1. "☁︎ Queued" badge stuck on the tile after the offline upload
 *    successfully drained. Root cause was a one-way `justQueued` state
 *    flag that never reset. The badge is now driven entirely by the
 *    live queuedKeys from UploadQueueProvider.
 *
 * 2. Dead-time after file selection (500ms–2s of pure spinner with no
 *    confirmation of what the user just picked). Fixed by calling
 *    setLocalPreview(URL.createObjectURL(file)) synchronously on file
 *    pick; the spinner now overlays the preview instead of replacing it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlacardPhotoSlot from '@/components/placard/PlacardPhotoSlot'

vi.mock('@/hooks/usePhotoUpload', () => ({
  usePhotoUpload: () => ({
    upload: vi.fn().mockResolvedValue('https://example.com/p.jpg'),
    status: 'idle',
    url:    null,
    errorMsg: null,
    reset:  vi.fn(),
  }),
}))

vi.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ online: true }),
}))

// Controllable UploadQueueProvider mock so tests can flip queuedKeys
// in and out and verify the badge reacts.
const queueState = { keys: new Set<string>() }
vi.mock('@/components/UploadQueueProvider', () => ({
  useUploadQueue: () => ({
    queue: [],
    queueCount: 0,
    queuedKeys: queueState.keys,
    syncing: false,
    enqueue: vi.fn(async ({ equipmentId, type }: { equipmentId: string; type: string }) => {
      queueState.keys = new Set(queueState.keys).add(`${equipmentId}:${type}`)
    }),
    syncNow: vi.fn(),
    clearAll: vi.fn(),
    refresh: vi.fn(),
  }),
  UploadQueueProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), storage: { from: vi.fn() } },
}))

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...props as object} alt="" />,
}))

beforeEach(() => {
  queueState.keys = new Set()
})

describe('PlacardPhotoSlot — "Queued" badge lifecycle', () => {
  it('does not show Queued when the slot is not in the queue', () => {
    render(
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl="https://example.com/existing.jpg"
      />,
    )
    expect(screen.queryByText(/Queued/)).not.toBeInTheDocument()
  })

  it('shows Queued while the slot is in the live queue', () => {
    // Badge sits on top of the preview image, so existingUrl has to be
    // present for the preview branch to render — matches the real flow
    // where the user's queued photo drained and left a URL behind.
    queueState.keys = new Set(['EQ-001:EQUIP'])
    render(
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl="https://example.com/queued.jpg"
      />,
    )
    expect(screen.getByText(/Queued/)).toBeInTheDocument()
  })

  it('clears the Queued badge when the live queue no longer contains the key', () => {
    queueState.keys = new Set(['EQ-001:EQUIP'])
    const { rerender } = render(
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl="https://example.com/existing.jpg"
      />,
    )
    expect(screen.getByText(/Queued/)).toBeInTheDocument()

    // Simulate the UploadQueueProvider draining the queue.
    queueState.keys = new Set()
    rerender(
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl="https://example.com/existing.jpg"
      />,
    )
    expect(screen.queryByText(/Queued/)).not.toBeInTheDocument()
  })

  it('does not show Queued for a different equipment+type than the one queued', () => {
    queueState.keys = new Set(['EQ-001:ISO']) // different type
    render(
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl="https://example.com/existing.jpg"
      />,
    )
    expect(screen.queryByText(/Queued/)).not.toBeInTheDocument()
  })
})

describe('PlacardPhotoSlot — instant preview on file pick', () => {
  it('displays the picked file as a preview synchronously via a blob URL', async () => {
    const user = userEvent.setup()
    render(
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl={null}
      />,
    )

    // Both the button and the hidden file input carry the same aria-label,
    // so narrow to the input element.
    const fileInput = screen.getByLabelText('Upload Equipment Photo', { selector: 'input' }) as HTMLInputElement
    const picked = new File(['x'], 'tall-panel.jpg', { type: 'image/jpeg' })

    // Track createObjectURL calls so we can assert the preview was set
    // synchronously on pick, before any async validation/compression.
    const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pick')

    await act(async () => {
      await user.upload(fileInput, picked)
    })

    // The very first createObjectURL call must be for the raw file —
    // that's the "instant preview" guarantee. Later calls (after
    // compression) are allowed and expected.
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][0]).toBe(picked)
    spy.mockRestore()
  })
})
