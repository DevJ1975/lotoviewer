import { beforeEach, describe, expect, it, vi } from 'vitest'

// Unit tests for the server-side placard regenerator. The regenerator
// is the seam between the public review route (where a supervisor
// replaces a photo) and the rest of the LOTO module (where the
// placard PDF stored in the loto-photos bucket has to match the new
// photo). We mock pdfPlacard's generator and supply a thin
// supabase-client-like surface; we're exercising the helper's
// orchestration, not pdf-lib or Postgres.

const { generatePdfMock } = vi.hoisted(() => ({
  generatePdfMock: vi.fn(),
}))

vi.mock('@/lib/pdfPlacard', () => ({
  generatePlacardPdf: generatePdfMock,
}))

import { regenerateAndUploadPlacard } from '@/lib/loto/regeneratePlacard'

interface AdminStubOpts {
  equipmentRow?:  { equipment_id: string; description: string } | null
  equipmentErr?:  string | null
  stepsErr?:      string | null
  uploadErr?:     string | null
  patchErr?:      string | null
}

/**
 * Builds a minimal SupabaseClient-shaped object that satisfies the
 * regenerator's call graph:
 *   admin.from('loto_equipment').select('*').eq().eq().maybeSingle()
 *   admin.from('loto_steps').select('*').eq().eq().order()
 *   admin.storage.from('loto-photos').upload(...)
 *   admin.storage.from('loto-photos').getPublicUrl(...)
 *   admin.from('loto_equipment').update().eq().eq()
 *
 * Returns the stub plus the captured upload calls so a test can
 * assert on them.
 */
function makeAdminStub(opts: AdminStubOpts) {
  const uploads: Array<{ path: string; bytes: ArrayBuffer | Uint8Array; contentType?: string }> = []
  const updates: Array<{ payload: unknown }> = []

  const bucket = {
    upload: vi.fn(async (path: string, bytes: Uint8Array, options: { contentType?: string }) => {
      uploads.push({ path, bytes, contentType: options?.contentType })
      return { error: opts.uploadErr ? { message: opts.uploadErr } : null }
    }),
    getPublicUrl: vi.fn((path: string) => ({ data: { publicUrl: `https://cdn.example/${path}` } })),
  }

  function selectEquipment() {
    const chain = {
      select: () => chain,
      eq:     () => chain,
      maybeSingle: async () => ({
        data: opts.equipmentRow ?? null,
        error: opts.equipmentErr ? { message: opts.equipmentErr } : null,
      }),
    }
    return chain
  }

  function selectSteps() {
    // The regenerator awaits the terminal `order(...)` directly (no
    // .maybeSingle / .single), so this is a thenable that resolves to
    // a { data, error } envelope.
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq:     () => chain,
      order:  () => ({
        then: (onF: (v: unknown) => unknown) =>
          Promise.resolve({ data: [], error: opts.stepsErr ? { message: opts.stepsErr } : null }).then(onF),
      }),
    }
    return chain
  }

  function updateEquipment() {
    const chain = {
      update: (payload: unknown) => {
        updates.push({ payload })
        return chain
      },
      eq: () => chain,
      // Final terminal — the regenerator awaits the chain directly after
      // two .eq() calls.
      then: (onF: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: opts.patchErr ? { message: opts.patchErr } : null }).then(onF),
    }
    return chain
  }

  let equipmentCallCount = 0
  return {
    uploads,
    updates,
    stub: {
      from: vi.fn((name: string) => {
        if (name === 'loto_equipment') {
          // First call is the SELECT; second call is the UPDATE.
          return equipmentCallCount++ === 0 ? selectEquipment() : updateEquipment()
        }
        if (name === 'loto_steps') return selectSteps()
        throw new Error(`Unexpected table: ${name}`)
      }),
      storage: { from: vi.fn(() => bucket) },
    },
  }
}

describe('regenerateAndUploadPlacard', () => {
  beforeEach(() => {
    generatePdfMock.mockReset()
  })

  it('throws when the equipment row is not found', async () => {
    const { stub } = makeAdminStub({ equipmentRow: null })
    await expect(regenerateAndUploadPlacard(
      // @ts-expect-error structural mock
      stub, 'tenant-x', 'EQ-MISSING',
    )).rejects.toThrow(/equipment not found/i)
  })

  it('throws when the equipment load returns an error', async () => {
    const { stub } = makeAdminStub({
      equipmentRow: null,
      equipmentErr: 'connection reset',
    })
    await expect(regenerateAndUploadPlacard(
      // @ts-expect-error structural mock
      stub, 'tenant-x', 'EQ-1',
    )).rejects.toThrow(/load equipment/i)
  })

  it('skips the upload when generatePlacardPdf throws', async () => {
    const { stub, uploads } = makeAdminStub({
      equipmentRow: { equipment_id: 'EQ-1', description: 'pump' },
    })
    generatePdfMock.mockRejectedValueOnce(new Error('pdf-lib fontkit boom'))
    await expect(regenerateAndUploadPlacard(
      // @ts-expect-error structural mock
      stub, 'tenant-x', 'EQ-1',
    )).rejects.toThrow(/fontkit/i)
    expect(uploads).toHaveLength(0)
  })

  it('uploads and patches when the render succeeds', async () => {
    const { stub, uploads, updates } = makeAdminStub({
      equipmentRow: { equipment_id: 'EQ-1', description: 'pump' },
    })
    generatePdfMock.mockResolvedValueOnce(new Uint8Array([0x25, 0x50, 0x44, 0x46]))

    const result = await regenerateAndUploadPlacard(
      // @ts-expect-error structural mock
      stub, 'tenant-x', 'EQ-1',
    )

    expect(generatePdfMock).toHaveBeenCalledTimes(1)
    expect(uploads).toHaveLength(1)
    expect(uploads[0]!.path).toContain('tenant-x/')
    expect(uploads[0]!.path).toMatch(/_placard\.pdf$/)
    expect(uploads[0]!.contentType).toBe('application/pdf')
    // Cache-bust suffix proves the URL changed shape between renders;
    // browsers (and the next admin viewer's <Image src>) won't pull a
    // stale copy from cache after a photo swap.
    expect(result.placardUrl).toMatch(/\?v=\d+$/)
    // The patch nulls signed_placard_url because any prior signature
    // was over the old bytes.
    expect(updates[0]?.payload).toMatchObject({ signed_placard_url: null })
  })

  it('throws when the storage upload fails', async () => {
    const { stub } = makeAdminStub({
      equipmentRow: { equipment_id: 'EQ-1', description: 'pump' },
      uploadErr:    'bucket policy denied',
    })
    generatePdfMock.mockResolvedValueOnce(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    await expect(regenerateAndUploadPlacard(
      // @ts-expect-error structural mock
      stub, 'tenant-x', 'EQ-1',
    )).rejects.toThrow(/bucket policy/i)
  })

  it('throws when the equipment patch fails', async () => {
    const { stub } = makeAdminStub({
      equipmentRow: { equipment_id: 'EQ-1', description: 'pump' },
      patchErr:     'RLS denied update',
    })
    generatePdfMock.mockResolvedValueOnce(new Uint8Array([0x25, 0x50, 0x44, 0x46]))
    await expect(regenerateAndUploadPlacard(
      // @ts-expect-error structural mock
      stub, 'tenant-x', 'EQ-1',
    )).rejects.toThrow(/patch equipment/i)
  })
})
