/**
 * PlacardPhotoSlot — on-device photo quality warning.
 *
 * The check is advisory: a too-dark or blurry photo shows a retake hint, but
 * it still uploads. These specs pin both halves, plus that a later good pick
 * clears an earlier warning.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlacardPhotoSlot from '@/components/placard/PlacardPhotoSlot'
import type { PhotoQuality } from '@soteria/core/photoQuality'

const uploadSpy = vi.fn()
const measureSpy = vi.fn<(file: Blob) => Promise<PhotoQuality | null>>()

vi.mock('@/hooks/usePhotoUpload', () => ({
  usePhotoUpload: () => ({
    upload: uploadSpy, status: 'idle', url: null, errorMsg: null, reset: vi.fn(),
  }),
}))

vi.mock('@/lib/photoQuality', () => ({
  measurePhotoQuality: (file: Blob) => measureSpy(file),
}))

vi.mock('@/lib/imageUtils', () => ({
  isHeic:        () => false,
  heicToJpeg:    vi.fn(),
  compressImage: vi.fn(async (file: File) => file),
}))

vi.mock('@/hooks/useNetworkStatus', () => ({ useNetworkStatus: () => ({ online: true }) }))

vi.mock('@/components/UploadQueueProvider', () => ({
  useUploadQueue: () => ({ enqueue: vi.fn(), queuedKeys: new Set<string>() }),
}))

vi.mock('@/lib/supabase', () => ({ supabase: { from: vi.fn(), storage: { from: vi.fn() } } }))

vi.mock('next/image', () => ({
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: Record<string, unknown>) => <img {...props as object} alt="" />,
}))

const quality = (issue: PhotoQuality['issue']): PhotoQuality => ({ issue, meanLuma: 100, sharpness: 500 })

async function pick(name: string) {
  const user = userEvent.setup()
  const input = screen.getByLabelText('Upload Isolation Photo', { selector: 'input' }) as HTMLInputElement
  await act(async () => { await user.upload(input, new File(['x'], name, { type: 'image/jpeg' })) })
}

beforeEach(() => {
  uploadSpy.mockReset().mockResolvedValue('https://example.com/iso.jpg')
  measureSpy.mockReset()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pick')
})

function renderSlot() {
  render(<PlacardPhotoSlot equipmentId="EQ-001" type="ISO" label="Isolation Photo" existingUrl={null} />)
}

describe('PlacardPhotoSlot — photo quality warning', () => {
  it('warns about a blurry photo and still uploads it', async () => {
    measureSpy.mockResolvedValue(quality('blurry'))
    renderSlot()

    await pick('shaky.jpg')

    expect(screen.getByRole('status')).toHaveTextContent(/looks blurry/i)
    expect(uploadSpy).toHaveBeenCalledTimes(1)
  })

  it('warns about a dark photo', async () => {
    measureSpy.mockResolvedValue(quality('too_dark'))
    renderSlot()

    await pick('cabinet.jpg')

    expect(screen.getByRole('status')).toHaveTextContent(/too dark/i)
  })

  it('shows nothing, and uploads, when the photo cannot be measured', async () => {
    measureSpy.mockResolvedValue(null)
    renderSlot()

    await pick('unknown.jpg')

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(uploadSpy).toHaveBeenCalledTimes(1)
  })

  it('clears an earlier warning once a good photo is picked', async () => {
    measureSpy.mockResolvedValueOnce(quality('blurry')).mockResolvedValueOnce(quality(null))
    renderSlot()

    await pick('shaky.jpg')
    expect(screen.getByRole('status')).toBeInTheDocument()

    await pick('retake.jpg')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
