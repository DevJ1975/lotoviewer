import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadPermitPage } from '@/lib/queries/permitDetail'
import { supabase } from '@/lib/supabase'

// loadPermitPage replaces the inline 8-parallel Promise.all that used
// to live in app/confined-spaces/[id]/permits/[permitId]/page.tsx. The
// test surface here pins the same graceful-degradation rules that the
// page used to enforce inline.

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn() },
}))

// Each chained call on supabase.from(...) returns a thenable shape.
// We build a small factory so each test can mint per-table responses
// without 60 lines of mock boilerplate.

interface QueryShape {
  // The eq/in/order/maybeSingle/single chain ends with a then-able
  // result. We only need to stub whichever methods the helper calls
  // for that table.
  data?:  unknown
  error?: { message: string } | null
}

function thenable(out: QueryShape) {
  // PostgREST chain mock — every chained method returns `this` so any
  // sequence resolves to the same shape we configured.
  const obj: Record<string, unknown> = {}
  obj.select       = () => obj
  obj.eq           = () => obj
  obj.in           = () => obj
  obj.gte          = () => obj
  obj.lte          = () => obj
  obj.order        = () => obj
  obj.is           = () => obj
  obj.single       = () => Promise.resolve({ data: out.data ?? null, error: out.error ?? null })
  obj.maybeSingle  = () => Promise.resolve({ data: out.data ?? null, error: out.error ?? null })
  // For chains that don't end in single() (atmospheric tests, entries,
  // meters, training, hot-work) the await terminates the chain on the
  // last call (.order()). Make .order() awaitable too.
  const promiseLike = Promise.resolve({ data: out.data ?? null, error: out.error ?? null })
  obj.then = promiseLike.then.bind(promiseLike)
  obj.catch = promiseLike.catch.bind(promiseLike)
  obj.finally = promiseLike.finally.bind(promiseLike)
  return obj
}

// Configure per-table responses by routing supabase.from(table) → thenable(opts[table]).
function setupTables(opts: Record<string, QueryShape>) {
  vi.mocked(supabase.from).mockImplementation((table: string) => {
    return thenable(opts[table] ?? { data: null, error: null }) as unknown as ReturnType<typeof supabase.from>
  })
}

describe('loadPermitPage', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('returns kind="not-found" when the space row is missing', async () => {
    setupTables({
      loto_confined_spaces:        { data: null, error: { message: 'No rows' } },
      loto_confined_space_permits: { data: { id: 'p', space_id: 's' }, error: null },
    })
    const res = await loadPermitPage({ spaceId: 's', permitId: 'p' })
    expect(res.ok).toBe(false)
    expect((res as { kind: string }).kind).toBe('not-found')
  })

  it('returns kind="not-found" when the permit row is missing', async () => {
    setupTables({
      loto_confined_spaces:        { data: { space_id: 's' }, error: null },
      loto_confined_space_permits: { data: null, error: { message: 'No rows' } },
    })
    const res = await loadPermitPage({ spaceId: 's', permitId: 'p' })
    expect(res.ok).toBe(false)
    expect((res as { kind: string }).kind).toBe('not-found')
  })

  it('returns ok with empty optional collections when only space + permit succeed', async () => {
    // The graceful-degradation guarantee: pre-migration-012 (entries +
    // meters), pre-migration-014 (org_config), pre-migration-017
    // (training), pre-migration-019 (hot-work cross-link) — any of
    // those tables errors out → empty result, not a thrown exception.
    setupTables({
      loto_confined_spaces:        { data: { space_id: 's', description: 'd' }, error: null },
      loto_confined_space_permits: { data: { id: 'p', space_id: 's', entrants: [], attendants: [] }, error: null },
      loto_atmospheric_tests:      { data: null, error: { message: 'tests table missing' } },
      loto_confined_space_entries: { data: null, error: { message: 'entries table missing' } },
      loto_gas_meters:             { data: null, error: { message: 'meters table missing' } },
      loto_org_config:             { data: null, error: { message: 'config table missing' } },
      loto_training_records:       { data: null, error: { message: 'training table missing' } },
      loto_hot_work_permits:       { data: null, error: { message: 'hot-work table missing' } },
    })
    const res = await loadPermitPage({ spaceId: 's', permitId: 'p' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.tests).toEqual([])
      expect(res.data.entries).toEqual([])
      expect(res.data.meters.size).toBe(0)
      expect(res.data.orgConfig).toBeNull()
      expect(res.data.trainingRecords).toEqual([])
      expect(res.data.linkedHotWork).toEqual([])
    }
  })

  it('builds the meters Map keyed by instrument_id', async () => {
    setupTables({
      loto_confined_spaces:        { data: { space_id: 's' }, error: null },
      loto_confined_space_permits: { data: { id: 'p', space_id: 's' }, error: null },
      loto_gas_meters: { data: [
        { instrument_id: 'BW-1', last_bump_at: '2026-04-01T00:00:00Z' },
        { instrument_id: 'BW-2', last_bump_at: '2026-04-02T00:00:00Z' },
      ], error: null },
    })
    const res = await loadPermitPage({ spaceId: 's', permitId: 'p' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.meters.size).toBe(2)
      expect(res.data.meters.get('BW-1')).toBeDefined()
      expect(res.data.meters.get('BW-2')).toBeDefined()
    }
  })

  it('passes through atmospheric tests + entries + linked hot-work in order', async () => {
    const tests = [{ id: 't1' }, { id: 't2' }]
    const entries = [{ id: 'e1' }]
    const hotWork = [{ id: 'hw1' }]
    setupTables({
      loto_confined_spaces:        { data: { space_id: 's' }, error: null },
      loto_confined_space_permits: { data: { id: 'p', space_id: 's' }, error: null },
      loto_atmospheric_tests:      { data: tests, error: null },
      loto_confined_space_entries: { data: entries, error: null },
      loto_hot_work_permits:       { data: hotWork, error: null },
    })
    const res = await loadPermitPage({ spaceId: 's', permitId: 'p' })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.tests).toHaveLength(2)
      expect(res.data.entries).toHaveLength(1)
      expect(res.data.linkedHotWork).toHaveLength(1)
    }
  })

  it('returns the orgConfig when present, null otherwise', async () => {
    setupTables({
      loto_confined_spaces:        { data: { space_id: 's' }, error: null },
      loto_confined_space_permits: { data: { id: 'p', space_id: 's' }, error: null },
      loto_org_config:             { data: { id: 1, work_order_url_template: 'https://wo/{ref}' }, error: null },
    })
    const res = await loadPermitPage({ spaceId: 's', permitId: 'p' })
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.data.orgConfig?.work_order_url_template).toBe('https://wo/{ref}')
  })
})
