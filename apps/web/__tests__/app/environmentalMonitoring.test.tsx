import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PermitRow } from '@/lib/environmental/client'
import type { Outfall, SiteDetail } from '@/lib/environmental/complianceClient'
import type { LimitRecord, ResultRecord } from '@/lib/environmental/monitoringClient'
import { exceedanceSummary, parseLimitRow, parseResultRow } from '@soteria/core/environmental/monitoring'

// The monitoring screen is driven the way a member or an admin would: read the summary and the
// results, see what each result was judged against, record a result, and (as an admin) correct,
// delete, manage the limits and adopt the draft defaults.

const listLimits = vi.fn()
const createLimit = vi.fn()
const updateLimit = vi.fn()
const deleteLimit = vi.fn()
const adoptDefaults = vi.fn()
const listResults = vi.fn()
const createResult = vi.fn()
const updateResult = vi.fn()
const deleteResult = vi.fn()
const getMonitoringSummary = vi.fn()
vi.mock('@/lib/environmental/monitoringClient', () => ({
  listLimits: (...a: unknown[]) => listLimits(...a),
  createLimit: (...a: unknown[]) => createLimit(...a),
  updateLimit: (...a: unknown[]) => updateLimit(...a),
  deleteLimit: (...a: unknown[]) => deleteLimit(...a),
  adoptDefaults: (...a: unknown[]) => adoptDefaults(...a),
  listResults: (...a: unknown[]) => listResults(...a),
  createResult: (...a: unknown[]) => createResult(...a),
  updateResult: (...a: unknown[]) => updateResult(...a),
  deleteResult: (...a: unknown[]) => deleteResult(...a),
  getMonitoringSummary: (...a: unknown[]) => getMonitoringSummary(...a),
}))
const listOutfalls = vi.fn()
vi.mock('@/lib/environmental/complianceClient', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/complianceClient')>('@/lib/environmental/complianceClient')
  return { ...actual, listOutfalls: (...a: unknown[]) => listOutfalls(...a) }
})
const listPermits = vi.fn()
vi.mock('@/lib/environmental/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/client')>('@/lib/environmental/client')
  return { ...actual, listPermits: (...a: unknown[]) => listPermits(...a) }
})
vi.mock('@/lib/environmental/complianceEvidence', async () => {
  const actual = await vi.importActual<typeof import('@/lib/environmental/complianceEvidence')>('@/lib/environmental/complianceEvidence')
  return { ...actual, uploadEvidence: vi.fn(), evidenceUrl: vi.fn().mockResolvedValue('https://signed.example/report.pdf') }
})

// Stable objects, as the real hooks return (the scope is memoized there): a new object on every
// render would re-run the page's load effects.
const AT_SITE = { tenantId: 'tenant-1', facilityId: 'site-1' }
const ROLL_UP = { tenantId: 'tenant-1', facilityId: null }
const profile = (over: Record<string, unknown> = {}) => ({ stormwater_coverage: 'general_permit', stormwater_general_permit: 'ca_igp', ...over })
const siteWith = (profileOver: Record<string, unknown> = {}) => ({
  facility: { id: 'site-1', name: 'Plant 1', state: 'CA' },
  jurisdiction: { chain: ['federal', 'CA'], state: 'CA', status: 'supported' },
  notice: null,
  profile: profile(profileOver),
  packs: [{ jurisdiction: 'federal', version: '1', status: 'draft', last_verified: null }],
}) as unknown as SiteDetail

let env: { scope: typeof AT_SITE | typeof ROLL_UP; facilityId: string | null; facilityName: string | null; canAdmin: boolean; ready: boolean }
let site: SiteDetail | null
const adminAtSite = () => ({ scope: AT_SITE, facilityId: 'site-1', facilityName: 'Plant 1', canAdmin: true, ready: true })
const memberAtSite = () => ({ ...adminAtSite(), canAdmin: false })
const adminInRollUp = () => ({ scope: ROLL_UP, facilityId: null, facilityName: null, canAdmin: true, ready: true })

vi.mock('@/lib/environmental/useEnvironmental', () => ({
  useEnvironmentalScope: () => env,
  useEnvironmentalSite: () => ({ site, loading: false, error: null, reload: vi.fn(), setSite: vi.fn() }),
}))
const switchFacility = vi.fn()
const FACILITIES = { available: [{ id: 'site-1', name: 'Plant 1' }, { id: 'site-2', name: 'Plant 2' }], switchFacility }
vi.mock('@/components/FacilityProvider', () => ({ useFacility: () => FACILITIES }))
vi.mock('@/components/PageHeader', () => ({
  PageHeader: ({ title, description }: { title: string; description?: string }) => <header><h1>{title}</h1><p>{description}</p></header>,
}))

import { ApiError } from '@/lib/environmental/complianceClient'
import EnvironmentalMonitoring from '@/app/environmental/compliance/monitoring/page'

// ── fixtures ────────────────────────────────────────────────────────────────
const outfall = (over: Partial<Outfall>): Outfall => ({
  id: 'o-1', facility_id: 'site-1', permit_id: null, code: 'OF-001', name: null, receiving_water: null, drainage_area: null,
  latitude: null, longitude: null, outfall_type: 'stormwater', substantially_identical_to: null, is_sampling_point: true,
  status: 'active', photo_path: null, notes: null, ...over,
})
const OF1 = outfall({ id: 'o-1', code: 'OF-001', name: 'North apron' })
const OF2 = outfall({ id: 'o-2', code: 'OF-002', name: 'South dock' })
const OF_REMOVED = outfall({ id: 'o-3', code: 'OF-003', status: 'removed' })

const limitRec = (over: Partial<LimitRecord>): LimitRecord => ({
  id: 'l-0', facility_id: 'site-1', outfall_id: null, permit_id: null, parameter: 'TSS', unit: 'mg/L', limit_kind: 'instantaneous_max', value: 100,
  basis: 'benchmark', citation: null, verify: null, source: 'tenant', library_key: null, effective_from: null, effective_to: null, ...over,
})
const BENCHMARK  = limitRec({ id: 'l-benchmark', basis: 'benchmark', value: 100 })
const PERMIT     = limitRec({ id: 'l-permit', basis: 'permit_limit', value: 150, citation: 'Permit table 3' })
const PH_MIN     = limitRec({ id: 'l-ph-min', parameter: 'pH', unit: 's.u.', limit_kind: 'instantaneous_min', value: 6, basis: 'numeric_action_level', source: 'library', library_key: 'ca-igp-nal-ph-instantaneous-min', citation: 'IGP Order 2014-0057-DWQ, Table 2', verify: 'Written from recollection of the IGP. Confirm the value.' })
const PH_MAX     = limitRec({ id: 'l-ph-max', parameter: 'pH', unit: 's.u.', limit_kind: 'instantaneous_max', value: 9, basis: 'numeric_action_level', source: 'library', library_key: 'ca-igp-nal-ph-instantaneous-max', citation: 'IGP Order 2014-0057-DWQ, Table 2', verify: 'Written from recollection of the IGP. Confirm the value.' })
const ANNUAL_TSS = limitRec({ id: 'l-annual', limit_kind: 'annual_average', value: 100, basis: 'numeric_action_level' })
const OIL        = limitRec({ id: 'l-oil', parameter: 'Oil & grease', value: 15, basis: 'permit_limit' })
const LIMITS = [OIL, PH_MAX, PH_MIN, PERMIT, BENCHMARK, ANNUAL_TSS]

const resultRec = (over: Partial<ResultRecord>): ResultRecord => ({
  id: 'r-0', facility_id: 'site-1', outfall_id: 'o-1', parameter: 'TSS', unit: 'mg/L', value: 50, below_detection: false,
  sampled_at: '2026-02-10T10:00:00+00:00', event_label: null, lab: null, evidence_id: null, note: null, sampled_by: 'u-1', ...over,
})
const R_BOTH     = resultRec({ id: 'r-1', value: 200, sampled_at: '2026-02-10T10:00:00+00:00' })
const R_BENCH    = resultRec({ id: 'r-2', value: 120, sampled_at: '2026-02-09T10:00:00+00:00' })
const R_WITHIN   = resultRec({ id: 'r-3', outfall_id: 'o-2', value: 50, sampled_at: '2026-02-08T10:00:00+00:00' })
const R_PH       = resultRec({ id: 'r-4', outfall_id: 'o-2', parameter: 'pH', unit: 's.u.', value: 5.9, sampled_at: '2026-02-07T10:00:00+00:00' })
const R_ND       = resultRec({ id: 'r-5', outfall_id: null, value: 5, below_detection: true, sampled_at: '2026-02-06T10:00:00+00:00', event_label: 'QSE 2026-02-06', lab: 'Acme Labs', evidence_id: 'tenant-1/monitoring/lab.pdf', note: 'Grab sample' })
const R_NO_LIMIT = resultRec({ id: 'r-6', parameter: 'Zinc', value: 3, sampled_at: '2026-02-05T10:00:00+00:00' })
const R_ND_HIGH  = resultRec({ id: 'r-7', outfall_id: 'o-2', parameter: 'Oil & grease', value: 50, below_detection: true, sampled_at: '2026-02-04T10:00:00+00:00' })
const RESULTS = [R_BOTH, R_BENCH, R_WITHIN, R_PH, R_ND, R_NO_LIMIT, R_ND_HIGH]

const NOW = Date.parse('2026-03-15T12:00:00Z')
const summaryResponse = (limits = LIMITS, results = RESULTS, over: Record<string, unknown> = {}) => ({
  summary: exceedanceSummary(limits.map(parseLimitRow), results.map(parseResultRow), NOW, { reportingYearStartMonth: 7 }),
  reporting_year_basis: { start_month: 7, verify: 'Written from recollection: the IGP reporting year runs July 1 to June 30. Confirm against the permit.' },
  truncated: false,
  ...over,
})

const permit = (over: Partial<PermitRow> = {}): PermitRow => ({
  id: 'p-1', facility_id: 'site-1', program: 'stormwater', instrument: 'permit', title: 'Industrial General Permit',
  agency: 'State Water Board', permit_number: 'CAS000001', jurisdiction: 'state:CA', holder_of_record: 'Acme Foods LLC',
  issued_on: '2024-01-01', expires_on: '2029-01-01', renewal_application_due_on: null, renewal_submitted_on: null,
  business_critical: false, owner_user_id: null, notes: null, retired_at: null, retired_reason: null,
  last_reviewed_at: null, next_review_due: '2027-01-01', standing: 'current', renewal_deadline: '2029-01-01', escalation: null,
  holder_mismatch: null, conditions_open: 0, conditions_overdue: 0, ...over,
}) as PermitRow

beforeEach(() => {
  for (const fn of [listLimits, createLimit, updateLimit, deleteLimit, adoptDefaults, listResults, createResult, updateResult, deleteResult,
    getMonitoringSummary, listOutfalls, listPermits, switchFacility]) fn.mockReset()
  listLimits.mockResolvedValue({ limits: LIMITS })
  listOutfalls.mockResolvedValue({ outfalls: [OF2, OF_REMOVED, OF1] })
  getMonitoringSummary.mockResolvedValue(summaryResponse())
  listResults.mockResolvedValue({ results: RESULTS, next_cursor: null })
  listPermits.mockResolvedValue({ permits: [permit()] })
  env = adminAtSite()
  site = siteWith()
})

async function screenLoaded() { await screen.findByRole('table', { name: 'Sample results' }) }
/** The results row whose sample time is `at`. */
const resultRow = (at: string) => within(screen.getByRole('rowheader', { name: new RegExp(`^${at}`) }).closest('tr')!)
const limitRow = (parameter: string, bound: string) =>
  within(screen.getAllByRole('rowheader', { name: parameter }).map(h => h.closest('tr')!).find(tr => tr.textContent?.includes(bound))!)

describe('the summary strip', () => {
  it('counts permit-limit exceedances and benchmark or action-level exceedances in separate cards, each named and explained', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const summary = within(screen.getByRole('region', { name: 'Exceedances this reporting year' }))

    // R1 passes 150 (1); R1, R2 pass the benchmark and R4 the pH action level (3).
    const permitCard = within(summary.getByRole('group', { name: 'Permit and local limit exceedances' }))
    const actionCard = within(summary.getByRole('group', { name: 'Benchmark and action level exceedances' }))
    expect(permitCard.getByText('1')).toBeInTheDocument()
    expect(actionCard.getByText('3')).toBeInTheDocument()
    expect(permitCard.getByText('Results above a limit that binds the site.')).toBeInTheDocument()
    expect(actionCard.getByText(/not violations of the permit/)).toBeInTheDocument()
  })

  it('does not show a card for internal targets unless one was missed', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(screen.queryByRole('group', { name: 'Internal target exceedances' })).toBeNull()
  })

  it('shows an internal-target card, still separate, when one was missed', async () => {
    const internal = limitRec({ id: 'l-internal', basis: 'self_imposed', value: 40 })
    listLimits.mockResolvedValue({ limits: [...LIMITS, internal] })
    getMonitoringSummary.mockResolvedValue(summaryResponse([...LIMITS, internal]))
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const card = within(screen.getByRole('group', { name: 'Internal target exceedances' }))
    expect(card.getByText('3')).toBeInTheDocument()
  })

  it('names the reporting year and carries the note to confirm its basis', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(screen.getByText(/Reporting year 2025-26: 2025-07-01 to 2026-06-30/)).toBeInTheDocument()
    expect(screen.getByText(/the IGP reporting year runs July 1 to June 30/)).toBeInTheDocument()
  })

  it('breaks the counts down by outfall, each outfall with its two counts side by side', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const table = within(screen.getByRole('table', { name: 'Exceedances this reporting year, by outfall' }))
    const of1 = within(table.getByRole('rowheader', { name: 'OF-001' }).closest('tr')!)
    const of2 = within(table.getByRole('rowheader', { name: 'OF-002' }).closest('tr')!)
    expect(of1.getAllByRole('cell').map(c => c.textContent)).toEqual(['1', '2'])
    expect(of2.getAllByRole('cell').map(c => c.textContent)).toEqual(['0', '1'])
    expect(table.getByRole('rowheader', { name: 'Site-level' })).toBeInTheDocument()
  })

  it('says when the year held more results than could be read', async () => {
    getMonitoringSummary.mockResolvedValue(summaryResponse(LIMITS, RESULTS, { truncated: true }))
    render(<EnvironmentalMonitoring />)
    expect(await screen.findByText(/counts may be low/)).toBeInTheDocument()
  })
})

describe('the results table', () => {
  it('lists the results as the API gave them, newest first, with the outfall, parameter and value', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const table = screen.getByRole('table', { name: 'Sample results' })
    const times = within(table).getAllByRole('rowheader').map(h => h.textContent)
    expect(times).toEqual([
      '2026-02-10 10:00 UTC', '2026-02-09 10:00 UTC', '2026-02-08 10:00 UTC', '2026-02-07 10:00 UTC', '2026-02-06 10:00 UTC',
      '2026-02-05 10:00 UTC', '2026-02-04 10:00 UTC',
    ])
    const row = resultRow('2026-02-10 10:00 UTC')
    expect(row.getByText('OF-001')).toBeInTheDocument()
    expect(row.getByText('TSS')).toBeInTheDocument()
    expect(row.getByText('200 mg/L')).toBeInTheDocument()
  })

  it('names an exceedance for the kind of limit it passed: a permit limit and a benchmark never share a label', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()

    const both = resultRow('2026-02-10 10:00 UTC')
    expect(both.getByText('Exceeds permit limit')).toBeInTheDocument()
    expect(both.getByText('Exceeds benchmark')).toBeInTheDocument()

    const benchmarkOnly = resultRow('2026-02-09 10:00 UTC')
    expect(benchmarkOnly.getByText('Exceeds benchmark')).toBeInTheDocument()
    expect(benchmarkOnly.queryByText('Exceeds permit limit')).toBeNull()
    expect(benchmarkOnly.getByText('Within')).toBeInTheDocument()

    expect(resultRow('2026-02-07 10:00 UTC').getByText('Exceeds numeric action level')).toBeInTheDocument()
  })

  it('colours a permit-limit exceedance differently from a benchmark exceedance', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const row = resultRow('2026-02-10 10:00 UTC')
    expect(row.getByText('Exceeds permit limit').className).toMatch(/rose/)
    expect(row.getByText('Exceeds benchmark').className).toMatch(/amber/)
    expect(row.getByText('Exceeds benchmark').className).not.toMatch(/rose/)
  })

  it('shows the limit each verdict was judged against: its bound and what kind of limit it is', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const row = resultRow('2026-02-10 10:00 UTC')
    expect(row.getByText('≤ 150 mg/L · Permit limit')).toBeInTheDocument()
    expect(row.getByText('≤ 100 mg/L · Benchmark')).toBeInTheDocument()
    const ph = resultRow('2026-02-07 10:00 UTC')
    expect(ph.getByText('≥ 6 s.u. · Numeric action level (draft default)')).toBeInTheDocument()
    expect(ph.getByText('≤ 9 s.u. · Numeric action level (draft default)')).toBeInTheDocument()
  })

  it('is within for a value exactly at the limit and for a non-detect whose reporting limit is under it, and says so', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const nd = resultRow('2026-02-06 10:00 UTC')
    expect(nd.getByText('Not detected (< 5 mg/L)')).toBeInTheDocument()
    expect(nd.getAllByText('Within')).toHaveLength(2)
    expect(nd.getAllByText(/the reporting limit \(5 mg\/L\) is within the limit/)).toHaveLength(2)
  })

  it('is not evaluable, never an exceedance, for a non-detect whose reporting limit is over the limit', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const row = resultRow('2026-02-04 10:00 UTC')
    expect(row.getByText('Not detected (< 50 mg/L)')).toBeInTheDocument()
    expect(row.getByText('Not evaluable')).toBeInTheDocument()
    expect(row.getByText(/could not show compliance/)).toBeInTheDocument()
    expect(row.queryByText(/Exceeds/)).toBeNull()
  })

  it('says when no limit applies', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(resultRow('2026-02-05 10:00 UTC').getByText('No limit applies')).toBeInTheDocument()
  })

  it('names a site-level sample, and shows the event, the lab and the note', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const row = resultRow('2026-02-06 10:00 UTC')
    expect(row.getByText('Site-level')).toBeInTheDocument()
    expect(row.getByText('QSE 2026-02-06')).toBeInTheDocument()
    expect(row.getByText('Acme Labs')).toBeInTheDocument()
    expect(row.getByText('Grab sample')).toBeInTheDocument()
  })

  it('links the lab report through a signed address, and shows a dash where there is none', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const link = await resultRow('2026-02-06 10:00 UTC').findByRole('link', { name: /Open lab report for/ })
    expect(link).toHaveAttribute('href', 'https://signed.example/report.pdf')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(resultRow('2026-02-10 10:00 UTC').queryByRole('link')).toBeNull()
  })
})

describe('the limits panel', () => {
  it('lists every limit with what kind of limit it is, how it is judged and where it applies', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const table = within(screen.getByRole('table', { name: 'Limits at this site' }))
    expect(table.getAllByRole('rowheader').map(h => h.textContent)).toEqual(['Oil & grease', 'pH', 'pH', 'TSS', 'TSS', 'TSS'])
    const permitRow = limitRow('TSS', '≤ 150 mg/L')
    expect(permitRow.getByText('Permit limit')).toBeInTheDocument()
    expect(permitRow.getByText('Whole site')).toBeInTheDocument()
    expect(limitRow('TSS', 'Annual average ≤ 100 mg/L').getByText('Numeric action level')).toBeInTheDocument()
  })

  it('says where each limit stands this reporting year, with its exceedances counted', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const permitRow = limitRow('TSS', '≤ 150 mg/L')
    expect(permitRow.getByText('Exceeds permit limit')).toBeInTheDocument()
    expect(permitRow.getByText(/4 judged, 1 over/)).toBeInTheDocument()
    const annual = limitRow('TSS', 'Annual average')
    expect(annual.getByText('Within')).toBeInTheDocument()
  })

  it('marks a library limit as a draft default and keeps its note to verify and its citation beside it', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const row = limitRow('pH', '≥ 6 s.u.')
    expect(row.getByText('Draft default')).toBeInTheDocument()
    expect(row.getByText('IGP Order 2014-0057-DWQ, Table 2')).toBeInTheDocument()
    expect(row.getByText(/Written from recollection of the IGP/)).toBeInTheDocument()
    expect(row.getByText(/Verify:/)).toBeInTheDocument()
    expect(limitRow('TSS', '≤ 150 mg/L').queryByText('Draft default')).toBeNull()
  })

  it('shows the draft-content badge, as the other environmental pages do', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(screen.getByText('Draft: pending expert review')).toBeInTheDocument()
    expect(screen.getByText('Federal + CA')).toBeInTheDocument()
  })

  it('explains an empty panel, to a member and to an admin', async () => {
    listLimits.mockResolvedValue({ limits: [] })
    getMonitoringSummary.mockResolvedValue(summaryResponse([], []))
    listResults.mockResolvedValue({ results: [], next_cursor: null })
    render(<EnvironmentalMonitoring />)
    expect(await screen.findByText(/No limits are recorded for this site/)).toHaveTextContent(/Add the limits from your permit/)
  })

  it('tells a member who can add limits instead of offering to', async () => {
    env = memberAtSite()
    listLimits.mockResolvedValue({ limits: [] })
    getMonitoringSummary.mockResolvedValue(summaryResponse([], []))
    render(<EnvironmentalMonitoring />)
    expect(await screen.findByText(/No limits are recorded for this site/)).toHaveTextContent(/A tenant admin can add them/)
    expect(screen.queryByRole('button', { name: 'Add limit' })).toBeNull()
  })
})

describe('who can do what', () => {
  it('lets a member read everything and record a result, and offers no way to change a limit or a recorded result', async () => {
    env = memberAtSite()
    render(<EnvironmentalMonitoring />)
    await screenLoaded()

    expect(screen.getByRole('button', { name: 'Add result' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Limits at this site' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Edit/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add limit' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adopt draft defaults' })).toBeNull()
  })

  it('does not ask for the permits of a member: only an admin links a limit to one', async () => {
    env = memberAtSite()
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(listPermits).not.toHaveBeenCalled()
  })

  it('lets an admin correct and delete a result, and add, edit and delete a limit, and adopt the defaults', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(screen.getAllByRole('button', { name: /^Edit result:/ })).toHaveLength(RESULTS.length)
    expect(screen.getAllByRole('button', { name: /^Delete result:/ })).toHaveLength(RESULTS.length)
    expect(screen.getAllByRole('button', { name: /^Edit limit:/ })).toHaveLength(LIMITS.length)
    expect(screen.getAllByRole('button', { name: /^Delete limit:/ })).toHaveLength(LIMITS.length)
    expect(screen.getByRole('button', { name: 'Add limit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Adopt draft defaults' })).toBeInTheDocument()
  })
})

describe('loading and failing', () => {
  it('asks for the limits, the outfalls, the summary and the first page of results of the site', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(listLimits).toHaveBeenCalledWith(AT_SITE)
    expect(listOutfalls).toHaveBeenCalledWith(AT_SITE)
    expect(getMonitoringSummary).toHaveBeenCalledWith(AT_SITE)
    expect(listResults).toHaveBeenCalledWith(AT_SITE, { outfallId: undefined, parameter: undefined })
    expect(listPermits).toHaveBeenCalledWith('tenant-1', { status: 'all' })
  })

  it('says what is wrong when the summary cannot be loaded, and shows no stale numbers', async () => {
    getMonitoringSummary.mockRejectedValue(new ApiError('Request failed (500)', 500, null, []))
    render(<EnvironmentalMonitoring />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)')
    expect(screen.queryByRole('group', { name: 'Permit and local limit exceedances' })).toBeNull()
  })

  it('asks for one site in the all-sites roll-up, and loads nothing', async () => {
    env = adminInRollUp(); site = null
    render(<EnvironmentalMonitoring />)
    expect(await screen.findByText('Choose a site')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add/i })).toBeNull()
    expect(listLimits).not.toHaveBeenCalled()
    expect(listResults).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Plant 2' }))
    expect(switchFacility).toHaveBeenCalledWith('site-2')
  })

  it('explains an empty site and offers a first result', async () => {
    listResults.mockResolvedValue({ results: [], next_cursor: null })
    render(<EnvironmentalMonitoring />)
    expect(await screen.findByText('No sample results recorded yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add result' })).toBeInTheDocument()
  })
})

describe('filters and paging', () => {
  it('narrows to an outfall, then to a parameter, asking the API each time', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()

    await userEvent.selectOptions(screen.getByLabelText(/^Show outfall/), 'o-2')
    await waitFor(() => expect(listResults).toHaveBeenLastCalledWith(AT_SITE, { outfallId: 'o-2', parameter: undefined }))

    await userEvent.selectOptions(screen.getByLabelText(/^Show parameter/), 'pH')
    await waitFor(() => expect(listResults).toHaveBeenLastCalledWith(AT_SITE, { outfallId: 'o-2', parameter: 'pH' }))
  })

  it('offers the outfalls in code order, and the parameters the site has limits or results for', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const outfalls = within(screen.getByLabelText(/^Show outfall/)).getAllByRole('option').map(o => o.textContent)
    expect(outfalls).toEqual(['All outfalls', 'OF-001: North apron', 'OF-002: South dock', 'OF-003'])
    const parameters = within(screen.getByLabelText(/^Show parameter/)).getAllByRole('option').map(o => o.textContent)
    expect(parameters).toEqual(['All parameters', 'Oil & grease', 'pH', 'TSS', 'Zinc'])
  })

  it('says nothing matches, and how to get back, when a filter shows no results', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    listResults.mockResolvedValue({ results: [], next_cursor: null })
    await userEvent.selectOptions(screen.getByLabelText(/^Show outfall/), 'o-1')
    expect(await screen.findByText('No results match these filters')).toBeInTheDocument()
  })

  it('shows older results a page at a time, only while there are more', async () => {
    listResults.mockResolvedValueOnce({ results: [R_BOTH, R_BENCH], next_cursor: 'cursor-1' })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    expect(screen.getAllByRole('rowheader').filter(h => /UTC$/.test(h.textContent ?? ''))).toHaveLength(2)

    listResults.mockResolvedValueOnce({ results: [R_WITHIN], next_cursor: null })
    await userEvent.click(screen.getByRole('button', { name: 'Show older results' }))

    await waitFor(() => expect(listResults).toHaveBeenLastCalledWith(AT_SITE, { outfallId: undefined, parameter: undefined, cursor: 'cursor-1' }))
    await waitFor(() => expect(screen.getAllByRole('rowheader').filter(h => /UTC$/.test(h.textContent ?? ''))).toHaveLength(3))
    expect(screen.queryByRole('button', { name: 'Show older results' })).toBeNull()
  })
})

describe('recording a result', () => {
  async function openForm() {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add result' }))
    return within(await screen.findByRole('dialog', { name: 'Add a result' }))
  }
  const setTime = (form: ReturnType<typeof within>, value: string) => fireEvent.change(form.getByLabelText(/^Sampled at/), { target: { value } })

  it('sends what was entered as the API expects it, then closes and reloads everything', async () => {
    createResult.mockResolvedValue({ result: R_BOTH })
    const form = await openForm()

    await userEvent.selectOptions(form.getByLabelText(/^Outfall/), 'o-2')
    await userEvent.type(form.getByLabelText(/^Parameter/), 'TSS')
    await userEvent.type(form.getByLabelText(/^Result/), '42.5')
    // the unit follows the TSS limit's, once the parameter is left
    expect(form.getByLabelText(/^Unit/)).toHaveValue('mg/L')
    setTime(form, '2026-02-03T10:30')
    await userEvent.type(form.getByLabelText(/^Storm event or sample ID/), ' QSE 2026-02-03 ')
    await userEvent.type(form.getByLabelText(/^Laboratory/), 'Acme Labs')
    await userEvent.click(form.getByRole('button', { name: 'Add result' }))

    await waitFor(() => expect(createResult).toHaveBeenCalledTimes(1))
    expect(createResult).toHaveBeenCalledWith(AT_SITE, {
      outfall_id: 'o-2', parameter: 'TSS', value: 42.5, unit: 'mg/L', below_detection: false,
      sampled_at: new Date(2026, 1, 3, 10, 30).toISOString(), event_label: 'QSE 2026-02-03', lab: 'Acme Labs', evidence_id: null, note: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listResults).toHaveBeenCalledTimes(2))
    expect(listLimits).toHaveBeenCalledTimes(2)
    expect(getMonitoringSummary).toHaveBeenCalledTimes(2)
  })

  it('records a sample of the site as a whole when no outfall is chosen', async () => {
    createResult.mockResolvedValue({ result: R_ND })
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Parameter/), 'pH')
    await userEvent.type(form.getByLabelText(/^Result/), '7.1')
    await userEvent.type(form.getByLabelText(/^Unit/), 's.u.')
    await userEvent.click(form.getByRole('button', { name: 'Add result' }))
    await waitFor(() => expect(createResult).toHaveBeenCalledTimes(1))
    expect(createResult.mock.calls[0]![1]).toMatchObject({ outfall_id: null, parameter: 'pH', value: 7.1 })
  })

  it('starts the sample time at the moment the form is opened, on the sampler\'s own clock', async () => {
    const form = await openForm()
    const value = (form.getByLabelText(/^Sampled at/) as HTMLInputElement).value
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(Math.abs(new Date(value).getTime() - Date.now())).toBeLessThan(2 * 60 * 1000)
  })

  it('offers the parameters the site has limits for, and fills in that limit\'s unit when the unit is still blank', async () => {
    const form = await openForm()
    const options = Array.from(document.querySelectorAll('datalist option')).map(o => o.getAttribute('value'))
    expect(options).toEqual(['Oil & grease', 'pH', 'TSS', 'Zinc'])

    await userEvent.type(form.getByLabelText(/^Parameter/), 'pH')
    await userEvent.tab()
    expect(form.getByLabelText(/^Unit/)).toHaveValue('s.u.')
  })

  it('never replaces a unit that was typed already', async () => {
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Unit/), 'ug/L')
    await userEvent.type(form.getByLabelText(/^Parameter/), 'TSS')
    await userEvent.tab()
    expect(form.getByLabelText(/^Unit/)).toHaveValue('ug/L')
  })

  it('treats the value as a reporting limit when the sample was not detected, and sends the flag', async () => {
    createResult.mockResolvedValue({ result: R_ND })
    const form = await openForm()
    expect(form.getByLabelText(/^Result/)).toBeInTheDocument()
    await userEvent.click(form.getByRole('checkbox', { name: /^Not detected/ }))
    expect(form.getByLabelText(/^Reporting limit/)).toBeInTheDocument()
    expect(form.queryByLabelText(/^Result/)).toBeNull()

    await userEvent.type(form.getByLabelText(/^Parameter/), 'Copper')
    await userEvent.type(form.getByLabelText(/^Reporting limit/), '5')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    await userEvent.click(form.getByRole('button', { name: 'Add result' }))
    await waitFor(() => expect(createResult).toHaveBeenCalledTimes(1))
    expect(createResult.mock.calls[0]![1]).toMatchObject({ value: 5, below_detection: true })
  })

  it('lets a laboratory report be attached from a file or the camera roll', async () => {
    const form = await openForm()
    const input = form.getByLabelText('Attach the laboratory report')
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', 'image/*,application/pdf')
  })

  it('does not offer an outfall that has been removed for a new result', async () => {
    const form = await openForm()
    const options = within(form.getByLabelText(/^Outfall/)).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Site as a whole (no outfall)', 'OF-001: North apron', 'OF-002: South dock'])
  })

  it('refuses a result that is not a number before sending anything', async () => {
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Parameter/), 'Copper')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    fireEvent.change(form.getByLabelText(/^Result/), { target: { value: '' } })
    // the browser's own required check stands in front of an empty field, so submit the form directly
    fireEvent.submit(form.getByRole('button', { name: 'Add result' }).closest('form')!)
    expect(await form.findByRole('alert')).toHaveTextContent('Enter the result as a number.')
    expect(createResult).not.toHaveBeenCalled()
  })

  it('shows the API\'s own words when it refuses a result, and keeps the form open', async () => {
    createResult.mockRejectedValue(new ApiError('bad', 400, 'invalid', ['sampled_at cannot be more than a day in the future.']))
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Parameter/), 'Copper')
    await userEvent.type(form.getByLabelText(/^Result/), '1')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    await userEvent.click(form.getByRole('button', { name: 'Add result' }))

    expect(await form.findByRole('alert')).toHaveTextContent('sampled_at cannot be more than a day in the future.')
    expect(screen.getByRole('dialog', { name: 'Add a result' })).toBeInTheDocument()
    expect(listResults).toHaveBeenCalledTimes(1)
  })

  it('says that a recorded result can be changed only by an administrator', async () => {
    await openForm()
    expect(screen.getByText(/Only an administrator can change it afterwards/)).toBeInTheDocument()
  })

  it('closes on Escape without saving, and hands focus back to where it came from', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const trigger = screen.getByRole('button', { name: 'Add result' })
    await userEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Add a result' })

    await userEvent.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(createResult).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('is open to a member', async () => {
    env = memberAtSite()
    createResult.mockResolvedValue({ result: R_BOTH })
    const form = await openForm()
    await userEvent.type(form.getByLabelText(/^Parameter/), 'Copper')
    await userEvent.type(form.getByLabelText(/^Result/), '1')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    await userEvent.click(form.getByRole('button', { name: 'Add result' }))
    await waitFor(() => expect(createResult).toHaveBeenCalledTimes(1))
  })
})

describe('correcting and deleting a result (admins)', () => {
  const action = (verb: 'Edit' | 'Delete', at: string) => resultRow(at).getByRole('button', { name: new RegExp(`^${verb} result: .*${at}`) })

  it('opens the stored result to correct, and sends the whole result back with the change', async () => {
    updateResult.mockResolvedValue({ result: R_BENCH })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(action('Edit', '2026-02-09 10:00 UTC'))
    const form = within(await screen.findByRole('dialog', { name: 'Correct a result' }))

    expect(form.getByLabelText(/^Result/)).toHaveValue(120)
    expect(form.getByLabelText(/^Parameter/)).toHaveValue('TSS')
    expect(form.getByLabelText(/^Outfall/)).toHaveValue('o-1')

    await userEvent.clear(form.getByLabelText(/^Result/))
    await userEvent.type(form.getByLabelText(/^Result/), '95')
    await userEvent.click(form.getByRole('button', { name: 'Save correction' }))

    await waitFor(() => expect(updateResult).toHaveBeenCalledTimes(1))
    expect(updateResult.mock.calls[0]![1]).toBe('r-2')
    expect(updateResult.mock.calls[0]![2]).toMatchObject({ outfall_id: 'o-1', parameter: 'TSS', value: 95, unit: 'mg/L', below_detection: false })
    expect(createResult).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('asks first, says what deleting does to the counts, and deletes that one result when confirmed', async () => {
    deleteResult.mockResolvedValue({ ok: true })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(action('Delete', '2026-02-10 10:00 UTC'))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete the TSS result?' }))
    expect(dialog.getByText(/from the exceedance counts/)).toBeInTheDocument()
    expect(deleteResult).not.toHaveBeenCalled()

    await userEvent.click(dialog.getByRole('button', { name: 'Delete result' }))
    await waitFor(() => expect(deleteResult).toHaveBeenCalledWith(AT_SITE, 'r-1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listResults).toHaveBeenCalledTimes(2))
  })

  it('deletes nothing when the question is answered with Cancel', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(action('Delete', '2026-02-10 10:00 UTC'))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete the TSS result?' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(deleteResult).not.toHaveBeenCalled()
  })

  it('keeps the question open and says why when the delete fails', async () => {
    deleteResult.mockRejectedValue(new ApiError('That record no longer exists.', 404, 'not_found', []))
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(action('Delete', '2026-02-10 10:00 UTC'))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete the TSS result?' }))
    await userEvent.click(dialog.getByRole('button', { name: 'Delete result' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('That record no longer exists.')
  })
})

describe('managing limits (admins)', () => {
  it('adds a limit, with the kind of limit explained beside the choice, and reloads', async () => {
    createLimit.mockResolvedValue({ limit: PERMIT })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add limit' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add a limit' }))

    expect(form.getByText(/binds the site/)).toBeInTheDocument()
    expect(form.getByText(/not itself a violation/)).toBeInTheDocument()
    await userEvent.type(form.getByLabelText(/^Parameter/), 'Zinc')
    await userEvent.selectOptions(form.getByLabelText(/^How it is judged/), 'daily_max')
    await userEvent.selectOptions(form.getByLabelText(/^Kind of limit/), 'local_limit')
    await userEvent.type(form.getByLabelText(/^Limit/), '0.5')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    await userEvent.selectOptions(form.getByLabelText(/^Applies to/), 'o-2')
    await userEvent.selectOptions(form.getByLabelText(/^Permit/), 'p-1')
    await userEvent.type(form.getByLabelText(/^Source/), 'Sewer use ordinance 4.2')
    await userEvent.type(form.getByLabelText(/^Check before relying on this/), 'Ask the POTW')
    await userEvent.click(form.getByRole('button', { name: 'Add limit' }))

    await waitFor(() => expect(createLimit).toHaveBeenCalledTimes(1))
    expect(createLimit).toHaveBeenCalledWith(AT_SITE, {
      outfall_id: 'o-2', permit_id: 'p-1', parameter: 'Zinc', unit: 'mg/L', limit_kind: 'daily_max', value: 0.5, basis: 'local_limit',
      citation: 'Sewer use ordinance 4.2', verify: 'Ask the POTW', effective_from: null, effective_to: null,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listLimits).toHaveBeenCalledTimes(2))
  })

  it('offers the permits in force at this site, and no one else\'s', async () => {
    listPermits.mockResolvedValue({ permits: [permit(), permit({ id: 'p-9', facility_id: 'site-2', title: 'Other Plant' }), permit({ id: 'p-7', title: 'Old', retired_at: '2026-01-01T00:00:00Z' })] })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add limit' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add a limit' }))
    const options = within(form.getByLabelText(/^Permit/)).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['No permit selected', 'Industrial General Permit CAS000001'])
  })

  it('refuses a limit that is not a number before sending anything', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add limit' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add a limit' }))
    await userEvent.type(form.getByLabelText(/^Parameter/), 'Zinc')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    fireEvent.submit(form.getByRole('button', { name: 'Add limit' }).closest('form')!)
    expect(await form.findByRole('alert')).toHaveTextContent('Enter the limit as a number.')
    expect(createLimit).not.toHaveBeenCalled()
  })

  it('edits a limit from what is stored, and sends the whole limit back', async () => {
    updateLimit.mockResolvedValue({ limit: PERMIT })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(within(limitRow('TSS', '≤ 150 mg/L').getByRole('button', { name: /^Edit limit:/ }).closest('tr')!).getByRole('button', { name: /^Edit limit:/ }))
    const form = within(await screen.findByRole('dialog', { name: 'Edit limit: TSS' }))

    expect(form.getByLabelText(/^Limit/)).toHaveValue(150)
    expect(form.getByLabelText(/^Kind of limit/)).toHaveValue('permit_limit')
    await userEvent.clear(form.getByLabelText(/^Limit/))
    await userEvent.type(form.getByLabelText(/^Limit/), '160')
    await userEvent.click(form.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateLimit).toHaveBeenCalledTimes(1))
    expect(updateLimit.mock.calls[0]![1]).toBe('l-permit')
    expect(updateLimit.mock.calls[0]![2]).toMatchObject({ value: 160, basis: 'permit_limit', citation: 'Permit table 3', parameter: 'TSS' })
  })

  it('shows the API\'s words when it refuses a limit', async () => {
    createLimit.mockRejectedValue(new ApiError('bad', 400, 'invalid', ['outfall_id must be an outfall at this site.']))
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(screen.getByRole('button', { name: 'Add limit' }))
    const form = within(await screen.findByRole('dialog', { name: 'Add a limit' }))
    await userEvent.type(form.getByLabelText(/^Parameter/), 'Zinc')
    await userEvent.type(form.getByLabelText(/^Limit/), '1')
    await userEvent.type(form.getByLabelText(/^Unit/), 'mg/L')
    await userEvent.click(form.getByRole('button', { name: 'Add limit' }))
    expect(await form.findByRole('alert')).toHaveTextContent('outfall_id must be an outfall at this site.')
  })

  it('asks before deleting a limit, and says the results are kept', async () => {
    deleteLimit.mockResolvedValue({ ok: true })
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    await userEvent.click(limitRow('TSS', '≤ 150 mg/L').getByRole('button', { name: /^Delete limit:/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Delete the TSS limit?' }))
    expect(dialog.getByText(/The results themselves are kept/)).toBeInTheDocument()
    expect(deleteLimit).not.toHaveBeenCalled()

    await userEvent.click(dialog.getByRole('button', { name: 'Delete limit' }))
    await waitFor(() => expect(deleteLimit).toHaveBeenCalledWith(AT_SITE, 'l-permit'))
    await waitFor(() => expect(listLimits).toHaveBeenCalledTimes(2))
  })
})

describe('adopting the draft defaults (admins)', () => {
  async function openDialog() {
    render(<EnvironmentalMonitoring />)
    await screen.findByRole('table', { name: 'Limits at this site' })
    await userEvent.click(screen.getByRole('button', { name: 'Adopt draft defaults' }))
    return within(await screen.findByRole('dialog', { name: 'Adopt draft default limits' }))
  }

  beforeEach(() => {
    // The two pH defaults are adopted already; the rest are on offer.
    listLimits.mockResolvedValue({ limits: [PH_MIN, PH_MAX, PERMIT] })
    getMonitoringSummary.mockResolvedValue(summaryResponse([PH_MIN, PH_MAX, PERMIT], []))
    listResults.mockResolvedValue({ results: [], next_cursor: null })
  })

  it('says these are drafts to check, and shows every default with its citation and the note a reviewer must clear', async () => {
    const dialog = await openDialog()
    expect(dialog.getByText(/written from recollection of the permit and not yet reviewed/)).toBeInTheDocument()
    const items = dialog.getAllByRole('listitem')
    expect(items).toHaveLength(6)
    for (const item of items) {
      expect(within(item).getByText(/Verify:/)).toBeInTheDocument()
      expect(within(item).getByText('IGP Order 2014-0057-DWQ, Table 2 (numeric action levels)')).toBeInTheDocument()
    }
  })

  it('names each default for what it is, and what kind of limit: an action level, not a permit limit', async () => {
    const dialog = await openDialog()
    expect(dialog.getByText('TSS: Annual average ≤ 100 mg/L')).toBeInTheDocument()
    expect(dialog.getByText('TSS: ≤ 400 mg/L')).toBeInTheDocument()
    expect(dialog.getByText('Oil & grease: ≤ 25 mg/L')).toBeInTheDocument()
    expect(dialog.getAllByText('Numeric action level')).toHaveLength(6)
    expect(dialog.queryByText('Permit limit')).toBeNull()
  })

  it('does not adopt anything on its own: nothing is ticked and the button is off until something is', async () => {
    const dialog = await openDialog()
    for (const box of dialog.getAllByRole('checkbox')) expect(box).not.toBeChecked()
    expect(dialog.getByRole('button', { name: 'Adopt selected' })).toBeDisabled()
    expect(adoptDefaults).not.toHaveBeenCalled()
  })

  it('shows the defaults that are already adopted as such, and does not let them be chosen again', async () => {
    const dialog = await openDialog()
    expect(dialog.getAllByText('Already adopted')).toHaveLength(2)
    expect(dialog.getByRole('checkbox', { name: /pH: ≥ 6 s\.u\./ })).toBeDisabled()
    expect(dialog.getByRole('checkbox', { name: /pH: ≤ 9 s\.u\./ })).toBeDisabled()
    expect(dialog.getByRole('checkbox', { name: /TSS: Annual average ≤ 100 mg\/L/ })).toBeEnabled()
  })

  it('adopts exactly the defaults ticked, for the whole site, then closes and reloads', async () => {
    adoptDefaults.mockResolvedValue({ created: 2, already_there: 0, limits: [] })
    const dialog = await openDialog()
    await userEvent.click(dialog.getByRole('checkbox', { name: /TSS: Annual average ≤ 100 mg\/L/ }))
    await userEvent.click(dialog.getByRole('checkbox', { name: /Oil & grease: ≤ 25 mg\/L/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Adopt 2 selected' }))

    await waitFor(() => expect(adoptDefaults).toHaveBeenCalledTimes(1))
    expect(adoptDefaults).toHaveBeenCalledWith(AT_SITE, { keys: ['ca-igp-nal-tss-annual', 'ca-igp-nal-og-instantaneous'], outfall_id: null })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(listLimits).toHaveBeenCalledTimes(2))
  })

  it('can adopt for one outfall, and then shows which defaults that outfall already has', async () => {
    adoptDefaults.mockResolvedValue({ created: 1, already_there: 0, limits: [] })
    const dialog = await openDialog()
    await userEvent.selectOptions(dialog.getByLabelText(/^Adopt for/), 'o-1')
    // the two pH defaults were adopted for the whole site, not for this outfall
    expect(dialog.queryAllByText('Already adopted')).toHaveLength(0)
    await userEvent.click(dialog.getByRole('checkbox', { name: /pH: ≥ 6 s\.u\./ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Adopt 1 selected' }))
    await waitFor(() => expect(adoptDefaults).toHaveBeenCalledWith(AT_SITE, { keys: ['ca-igp-nal-ph-instantaneous-min'], outfall_id: 'o-1' }))
  })

  it('shows the API\'s words when it refuses, and keeps the dialog open', async () => {
    adoptDefaults.mockRejectedValue(new ApiError('bad', 400, 'invalid', ['Not a default available for this site: made-up.']))
    const dialog = await openDialog()
    await userEvent.click(dialog.getByRole('checkbox', { name: /TSS: Annual average ≤ 100 mg\/L/ }))
    await userEvent.click(dialog.getByRole('button', { name: 'Adopt 1 selected' }))
    expect(await dialog.findByRole('alert')).toHaveTextContent('Not a default available for this site: made-up.')
  })

  it('closes on Cancel without adopting', async () => {
    const dialog = await openDialog()
    await userEvent.click(dialog.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(adoptDefaults).not.toHaveBeenCalled()
  })

  it('is not offered for a site whose profile names no general permit, and says why', async () => {
    site = siteWith({ stormwater_coverage: 'not_evaluated', stormwater_general_permit: null })
    render(<EnvironmentalMonitoring />)
    await screen.findByRole('table', { name: 'Limits at this site' })
    expect(screen.queryByRole('button', { name: 'Adopt draft defaults' })).toBeNull()
    expect(screen.getByText(/No draft default limits are offered for this site/)).toBeInTheDocument()
  })

  it('offers the MSGP benchmarks to a site on the EPA permit', async () => {
    site = siteWith({ stormwater_general_permit: 'epa_msgp' })
    ;(site as unknown as { jurisdiction: { chain: string[] } }).jurisdiction.chain = ['federal']
    const dialog = await openDialog()
    expect(dialog.getAllByRole('listitem')).toHaveLength(3)
    expect(dialog.getAllByText('Benchmark')).toHaveLength(3)
    expect(dialog.getAllByText(/2021 MSGP expired 2026-02-28/).length).toBeGreaterThan(0)
  })
})

describe('keyboard and screen readers', () => {
  it('gives every table a name and every column a header', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    for (const name of ['Sample results', 'Limits at this site', 'Exceedances this reporting year, by outfall']) {
      expect(screen.getByRole('table', { name })).toBeInTheDocument()
    }
    expect(screen.getAllByRole('columnheader').every(h => h.getAttribute('scope') === 'col')).toBe(true)
  })

  it('names the sections by their headings', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    for (const name of ['Exceedances this reporting year', 'Sample results', 'Limits at this site']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument()
    }
  })

  it('names each row action for the row it acts on, so a list of buttons is not a list of "Edit"', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const names = screen.getAllByRole('button', { name: /^Edit result:/ }).map(b => b.getAttribute('aria-label'))
    expect(new Set(names).size).toBe(names.length)
    expect(names[0]).toBe('Edit result: TSS at OF-001, 2026-02-10 10:00 UTC')
  })

  it('reaches every control with the keyboard: a dialog traps focus and returns it', async () => {
    render(<EnvironmentalMonitoring />)
    await screenLoaded()
    const trigger = screen.getByRole('button', { name: 'Add result' })
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog', { name: 'Add a result' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
})
