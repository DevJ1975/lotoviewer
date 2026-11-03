// @vitest-environment node
import { describe, it, expect } from 'vitest'

import AppleIcon, { contentType, size } from '@/app/apple-icon'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

describe('apple touch icon', () => {
  it('renders a 180x180 PNG', async () => {
    const response = AppleIcon()
    expect(contentType).toBe('image/png')
    expect(response.headers.get('content-type')).toBe('image/png')

    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 8)]).toEqual(PNG_SIGNATURE)

    // IHDR width/height are big-endian u32s at bytes 16 and 20.
    const view = new DataView(bytes.buffer)
    expect(view.getUint32(16)).toBe(size.width)
    expect(view.getUint32(20)).toBe(size.height)
  })
})
