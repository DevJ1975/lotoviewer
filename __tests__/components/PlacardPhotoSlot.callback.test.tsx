/**
 * Regression test: PlacardPhotoSlot's success effect must NOT refire every
 * time the parent passes a new inline onSuccess closure. Previously, that
 * caused an infinite loop that froze the app after any photo upload.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render } from '@testing-library/react'
import { useState } from 'react'
import PlacardPhotoSlot from '@/components/placard/PlacardPhotoSlot'
import { UploadQueueProvider } from '@/components/UploadQueueProvider'

vi.mock('@/hooks/usePhotoUpload', () => ({
  usePhotoUpload: () => ({
    upload: vi.fn().mockResolvedValue('https://example.com/photo.jpg'),
    status: 'success',
    url:    'https://example.com/photo.jpg',
    errorMsg: null,
    reset:  vi.fn(),
  }),
}))

vi.mock('@/hooks/useNetworkStatus', () => ({
  useNetworkStatus: () => ({ online: true }),
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from:    vi.fn(),
    storage: { from: vi.fn() },
  },
}))

// Parent that forces an extra re-render every time the child's success
// callback fires — without refs, this would loop forever.
function HarnessParent({ onCount }: { onCount: (n: number) => void }) {
  const [count, setCount] = useState(0)
  return (
    <UploadQueueProvider>
      <PlacardPhotoSlot
        equipmentId="EQ-001"
        type="EQUIP"
        label="Equipment Photo"
        existingUrl={null}
        onSuccess={() => {
          // Inline closure (new reference every render) + state mutation
          setCount(c => {
            const next = c + 1
            onCount(next)
            return next
          })
        }}
      />
    </UploadQueueProvider>
  )
}

describe('PlacardPhotoSlot — onSuccess must fire only once per URL', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does not loop even if onSuccess triggers parent re-renders', async () => {
    const onCount = vi.fn()
    await act(async () => { render(<HarnessParent onCount={onCount} />) })
    // Allow any queued effects to flush
    await act(async () => { await Promise.resolve() })
    // Success callback must fire at most once — the ref-guard must prevent
    // a runaway cascade.
    expect(onCount.mock.calls.length).toBeLessThanOrEqual(1)
  })
})
