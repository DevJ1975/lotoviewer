import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Deadline, SiteDetail } from '@/lib/environmental/client'
import * as client from '@/lib/environmental/client'
import EnvironmentalCalendarPage from '@/app/environmental/compliance/calendar/page'

// The compliance calendar screen against a mocked API and mocked providers, with
// the clock held at Wednesday, Oct 7 2026.

const env = vi.hoisted(() => ({ role: 'admin', userId: 'user-me' as string | null, facilityId: 'f1' as string | null }))

vi.mock('next/navigation', () => ({ usePathname: () => '/environmental/compliance/calendar' }))
vi.mock('@/components/TenantProvider', () => ({
  useTenant: () => ({ tenant: { id: 'tenant-1' }, role: env.role }),
}))
vi.mock('@/components/AuthProvider', () => ({
  useAuth: () => ({ userId: env.userId, profile: { is_superadmin: false } }),
}))
vi.mock('@/components/FacilityProvider', () => {
  const available = [{ id: 'f1', name: 'Plant A', state: null }, { id: 'f2', name: 'Plant B', state: 'TX' }]
  return {
    useFacility: () => ({
      facilityId: env.facilityId,
      facility: available.find(f => f.id === env.facilityId) ?? null,
      available,
      loading: false,
      switchFacility: vi.fn(),
    }),
  }
})
vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/environmental/client')>()),
  listDeadlines: vi.fn(),
  createDeadline: vi.fn(),
  updateDeadline: vi.fn(),
  completeDeadline: vi.fn(),
  getSite: vi.fn(),
  searchOwners: vi.fn(),
}))

const listDeadlines = vi.mocked(client.listDeadlines)
const createDeadline = vi.mocked(client.createDeadline)
const updateDeadline = vi.mocked(client.updateDeadline)
const completeDeadline = vi.mocked(client.completeDeadline)
const getSite = vi.mocked(client.getSite)
const searchOwners = vi.mocked(client.searchOwners)

const SCOPE = { tenantId: 'tenant-1', facilityId: 'f1' }
const ROLL_UP_SCOPE = { tenantId: 'tenant-1', facilityId: null }
const UNKNOWN_OWNER = '9d2c0b3e-5a41-4c0e-9f7e-2b1d6a8c3e55'
const VIEW_KEY = 'soteria.environmental.calendar.view.v1'

function deadline(overrides: Partial<Deadline>): Deadline {
  return {
    id: 'd', title: 'A deadline', description: null, regulatory_ref: null, program: 'stormwater',
    cadence: 'quarterly', cadence_days: null, next_due_at: '2026-10-20', status: 'open', lead_days: 14,
    due_anchor: 'fixed', owner_user_id: null, facility_id: 'f1', source: 'library', checklist_template_id: null,
    library_key: null, urgency: null, days_until: null, last_completed_at: null,
    ...overrides,
  }
}

const OVERDUE = deadline({
  id: 'd-overdue', title: 'Quarterly stormwater inspection', next_due_at: '2026-10-04', program: 'stormwater',
  regulatory_ref: 'MSGP 3.1', owner_user_id: 'user-pat', library_key: 'sw-fed-routine-inspection',
  last_completed_at: new Date(2026, 6, 1, 18, 30).toISOString(),
})
const DUE_SOON = deadline({
  id: 'd-soon', title: 'Renew air permit', next_due_at: '2026-10-19', program: 'air', cadence: 'annual',
  owner_user_id: 'user-me', library_key: 'permit-renewal:p1', lead_days: 30,
})
const UPCOMING = deadline({
  id: 'd-upcoming', title: 'Tier II report', next_due_at: '2027-03-01', program: 'epcra', cadence: 'annual',
  owner_user_id: UNKNOWN_OWNER, facility_id: null, source: 'tenant', lead_days: 30,
})
const DEADLINES = [UPCOMING, OVERDUE, DUE_SOON]

const SITE = {
  facility: { id: 'f1', name: 'Plant A', state: null },
  jurisdiction: { chain: ['federal'], status: 'unset' },
  packs: [{ jurisdiction: 'federal', version: '1', status: 'draft', last_verified: null }],
  notice: null,
} as unknown as SiteDetail

const PAT = { user_id: 'user-pat', display_name: 'Pat Rivera', email: 'pat@example.com' }
const ME = { user_id: 'user-me', display_name: 'Jamie Lee', email: 'jamie@example.com' }

function setUpApi() {
  listDeadlines.mockImplementation(async (_scope, query = {}) => ({
    obligations: DEADLINES.filter(d => (query.program ? d.program === query.program : true)),
  }))
  searchOwners.mockResolvedValue([PAT, ME])
  getSite.mockResolvedValue(SITE)
}

async function openList() {
  render(<EnvironmentalCalendarPage />)
  await screen.findByRole('table')
}

async function openMonth(user: ReturnType<typeof userEvent.setup>) {
  render(<EnvironmentalCalendarPage />)
  await user.click(await screen.findByRole('button', { name: 'Month' }))
  await screen.findByRole('heading', { name: 'October 2026' })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 7, 12, 0, 0))
  env.role = 'admin'
  env.userId = 'user-me'
  env.facilityId = 'f1'
  window.sessionStorage.clear()
  vi.resetAllMocks()
  setUpApi()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('list view', () => {
  it('groups open deadlines into Overdue, Due soon and Upcoming, most pressing first', async () => {
    await openList()
    const bands = screen.getAllByRole('rowgroup').filter(group => group.tagName === 'TBODY')
    expect(bands.map(band => within(band).getAllByRole('row')[0]!.textContent)).toEqual(['Overdue (1)', 'Due soon (1)', 'Upcoming (1)'])

    const overdue = screen.getByRole('rowgroup', { name: /Overdue/ })
    expect(within(overdue).getByRole('button', { name: 'Quarterly stormwater inspection' })).toBeInTheDocument()
    expect(within(overdue).getByText('3 days overdue')).toBeInTheDocument()
    expect(within(overdue).getByText('Oct 4, 2026')).toBeInTheDocument()

    const soon = screen.getByRole('rowgroup', { name: /Due soon/ })
    expect(within(soon).getByRole('button', { name: 'Renew air permit' })).toBeInTheDocument()
    expect(within(soon).getByText('in 12 days')).toBeInTheDocument()

    const upcoming = screen.getByRole('rowgroup', { name: /Upcoming/ })
    expect(within(upcoming).getByRole('button', { name: 'Tier II report' })).toBeInTheDocument()
    expect(within(upcoming).getByText('in 145 days')).toBeInTheDocument()
  })

  it('shows each row\'s program, source, reference, owner and last completion', async () => {
    await openList()
    const overdue = screen.getByRole('rowgroup', { name: /Overdue/ })
    expect(within(overdue).getByText('Stormwater')).toBeInTheDocument()
    expect(within(overdue).getByText('Library')).toBeInTheDocument()
    expect(within(overdue).getByText('MSGP 3.1')).toBeInTheDocument()
    expect(within(overdue).getByText('Last completed Jul 1, 2026')).toBeInTheDocument()
    expect(within(overdue).getByText('Pat Rivera')).toBeInTheDocument()

    expect(within(screen.getByRole('rowgroup', { name: /Due soon/ })).getByText('Permit renewal')).toBeInTheDocument()
    expect(within(screen.getByRole('rowgroup', { name: /Upcoming/ })).getByText('Custom')).toBeInTheDocument()
  })

  it('says "Assigned" for an owner it cannot name and never shows an id', async () => {
    await openList()
    const upcoming = screen.getByRole('rowgroup', { name: /Upcoming/ })
    expect(within(upcoming).getByText('Assigned')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(UNKNOWN_OWNER)
  })

  it('says "today" for a deadline due today', async () => {
    listDeadlines.mockResolvedValue({ obligations: [deadline({ id: 'd-today', title: 'Due today', next_due_at: '2026-10-07' })] })
    await openList()
    expect(screen.getByText('today')).toBeInTheDocument()
  })

  it('lists completed deadlines under their own heading, without calling them overdue', async () => {
    listDeadlines.mockResolvedValue({ obligations: [deadline({ id: 'd-done', title: 'Filed report', status: 'completed', next_due_at: '2026-01-15' })] })
    await openList()
    const done = screen.getByRole('rowgroup', { name: /Completed/ })
    expect(within(done).getByText('Filed report')).toBeInTheDocument()
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument()
  })

  it('has no Site column for one site', async () => {
    await openList()
    expect(screen.queryByRole('columnheader', { name: 'Site' })).not.toBeInTheDocument()
    expect(listDeadlines).toHaveBeenCalledWith(SCOPE, { status: 'open' })
  })

  it('shows the site\'s jurisdiction banner with its draft marker, and the how-to panel', async () => {
    await openList()
    expect(await screen.findByText('Plant A')).toBeInTheDocument()
    expect(screen.getByText(/Draft: pending expert review/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /How to use this page/ })).toBeInTheDocument()
  })

  it('shows the API\'s problems when the calendar cannot be loaded', async () => {
    listDeadlines.mockRejectedValue(new client.ApiError('Request failed', 500, null, ['The calendar could not be read.']))
    render(<EnvironmentalCalendarPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('The calendar could not be read.')
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('the all-sites roll-up', () => {
  beforeEach(() => { env.facilityId = null })

  it('adds a Site column naming each deadline\'s site, and "All sites" for one that has none', async () => {
    listDeadlines.mockResolvedValue({
      obligations: [OVERDUE, deadline({ id: 'd-b', title: 'Plant B report', facility_id: 'f2', next_due_at: '2026-10-10' }), UPCOMING],
    })
    await openList()
    expect(screen.getByRole('columnheader', { name: 'Site' })).toBeInTheDocument()
    expect(listDeadlines).toHaveBeenCalledWith(ROLL_UP_SCOPE, { status: 'open' })

    const rowOf = (title: string) => screen.getByRole('button', { name: title }).closest('tr')!
    expect(within(rowOf('Quarterly stormwater inspection')).getByText('Plant A')).toBeInTheDocument()
    expect(within(rowOf('Plant B report')).getByText('Plant B')).toBeInTheDocument()
    expect(within(rowOf('Tier II report')).getByText('All sites')).toBeInTheDocument()
  })

  it('does not read a site profile, and offers no checklist link, since the checklist belongs to one site', async () => {
    await openList()
    expect(getSite).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /Run checklist/ })).not.toBeInTheDocument()
  })
})

describe('month view', () => {
  it('lays out October 2026 as five Sunday-first weeks and marks today', async () => {
    const user = userEvent.setup()
    await openMonth(user)
    expect(screen.getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'SunSunday', 'MonMonday', 'TueTuesday', 'WedWednesday', 'ThuThursday', 'FriFriday', 'SatSaturday',
    ])

    const table = screen.getByRole('table', { name: 'October 2026' })
    expect(within(table).getAllByRole('row')).toHaveLength(6)
    const cells = within(table).getAllByRole('cell')
    expect(cells).toHaveLength(35)
    expect(cells[0]).toHaveTextContent(/^27$/)
    expect(cells[34]).toHaveTextContent(/^31$/)

    const today = table.querySelectorAll('[aria-current="date"]')
    expect(today).toHaveLength(1)
    expect(today[0]).toHaveTextContent(/^7/)
  })

  it('puts a deadline\'s chip on its due date, with the urgency in words', async () => {
    const user = userEvent.setup()
    await openMonth(user)
    expect(screen.getByRole('button', { name: 'Oct 4, 2026: 1 deadline' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overdue: Quarterly stormwater inspection' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Due soon: Renew air permit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tier II report/ })).not.toBeInTheDocument()
  })

  it('moves between months and back to today', async () => {
    const user = userEvent.setup()
    await openMonth(user)
    await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'November 2026' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Renew air permit/ })).not.toBeInTheDocument()

    for (let i = 0; i < 4; i++) await user.click(screen.getByRole('button', { name: 'Next month' }))
    expect(screen.getByRole('heading', { name: 'March 2027' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upcoming: Tier II report' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Previous month' }))
    expect(screen.getByRole('heading', { name: 'February 2027' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })

  it('shows three chips for a busy day and "+N more", which lists the whole day', async () => {
    const busy = Array.from({ length: 4 }, (_, i) => deadline({ id: `busy-${i}`, title: `Busy ${i}`, next_due_at: '2026-10-20' }))
    listDeadlines.mockResolvedValue({ obligations: busy })
    const user = userEvent.setup()
    await openMonth(user)

    expect(screen.getAllByRole('button', { name: /^(Due soon|Upcoming|Overdue): / })).toHaveLength(3)
    await user.click(screen.getByRole('button', { name: '+1 more on Oct 20, 2026' }))

    const panel = screen.getByRole('region', { name: 'Due Oct 20, 2026' })
    expect(within(panel).getAllByRole('button')).toHaveLength(4)
  })

  it('opens the same detail dialog from a chip and from a day', async () => {
    const user = userEvent.setup()
    await openMonth(user)
    await user.click(screen.getByRole('button', { name: 'Overdue: Quarterly stormwater inspection' }))
    expect(await screen.findByRole('dialog', { name: 'Quarterly stormwater inspection' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Oct 19, 2026: 1 deadline' }))
    const panel = screen.getByRole('region', { name: 'Due Oct 19, 2026' })
    await user.click(within(panel).getByRole('button', { name: 'Renew air permit' }))
    expect(await screen.findByRole('dialog', { name: 'Renew air permit' })).toBeInTheDocument()
  })

  it('says so when nothing matches, rather than drawing an empty grid', async () => {
    listDeadlines.mockResolvedValue({ obligations: [] })
    const user = userEvent.setup()
    render(<EnvironmentalCalendarPage />)
    await user.click(await screen.findByRole('button', { name: 'Month' }))
    expect(await screen.findByText('No deadlines yet')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})

describe('remembering the view', () => {
  it('opens in the view the person last chose this session', async () => {
    const user = userEvent.setup()
    await openMonth(user)
    expect(window.sessionStorage.getItem(VIEW_KEY)).toBe('month')

    cleanup()
    render(<EnvironmentalCalendarPage />)
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'List' }))
    expect(window.sessionStorage.getItem(VIEW_KEY)).toBe('list')
  })

  it('still works when the browser refuses storage', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Month' }))
    expect(await screen.findByRole('heading', { name: 'October 2026' })).toBeInTheDocument()
  })
})

describe('filters', () => {
  it('searches the title and the regulatory reference', async () => {
    const user = userEvent.setup()
    await openList()
    await user.type(screen.getByLabelText('Search'), 'AIR')
    expect(screen.getByRole('button', { name: 'Renew air permit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tier II report' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quarterly stormwater inspection' })).not.toBeInTheDocument()

    await user.clear(screen.getByLabelText('Search'))
    await user.type(screen.getByLabelText('Search'), 'msgp')
    expect(screen.getByRole('button', { name: 'Quarterly stormwater inspection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renew air permit' })).not.toBeInTheDocument()
  })

  it('asks the API for one program', async () => {
    const user = userEvent.setup()
    await openList()
    await user.selectOptions(screen.getByLabelText('Program'), 'air')
    await waitFor(() => expect(listDeadlines).toHaveBeenLastCalledWith(SCOPE, { status: 'open', program: 'air' }))
    expect(await screen.findByRole('button', { name: 'Renew air permit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tier II report' })).not.toBeInTheDocument()
  })

  it('asks the API for a status, and does not show the previous status\'s rows meanwhile', async () => {
    const closed = deadline({ id: 'd-closed', title: 'Closed out', status: 'completed', next_due_at: '2026-03-01' })
    listDeadlines.mockImplementation(async (_scope, query = {}) => ({ obligations: query.status === 'completed' ? [closed] : DEADLINES }))
    const user = userEvent.setup()
    await openList()
    await user.selectOptions(screen.getByLabelText('Status'), 'completed')
    await waitFor(() => expect(listDeadlines).toHaveBeenLastCalledWith(SCOPE, { status: 'completed' }))
    expect(await screen.findByRole('button', { name: 'Closed out' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Renew air permit' })).not.toBeInTheDocument()
  })

  it('shows only what is assigned to the signed-in person', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByLabelText('Assigned to me'))
    expect(screen.getByRole('button', { name: 'Renew air permit' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Quarterly stormwater inspection' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tier II report' })).not.toBeInTheDocument()

    await user.click(screen.getByLabelText('Assigned to me'))
    expect(screen.getByRole('button', { name: 'Tier II report' })).toBeInTheDocument()
  })

  it('says no deadlines match, and does not send the admin to the library, when a filter hides everything', async () => {
    const user = userEvent.setup()
    await openList()
    await user.type(screen.getByLabelText('Search'), 'zzz-no-such-thing')
    expect(screen.getByText('No deadlines match these filters')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Set up this site from the library/ })).not.toBeInTheDocument()
  })
})

describe('empty calendar', () => {
  beforeEach(() => { listDeadlines.mockResolvedValue({ obligations: [] }) })

  it('points an admin to the Overview page to set the site up from the library', async () => {
    render(<EnvironmentalCalendarPage />)
    expect(await screen.findByText('No deadlines yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Set up this site from the library' })).toHaveAttribute('href', '/environmental/compliance')
  })

  it('tells a member to ask an admin instead', async () => {
    env.role = 'member'
    render(<EnvironmentalCalendarPage />)
    expect(await screen.findByText('No deadlines yet')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Set up this site from the library/ })).not.toBeInTheDocument()
    expect(screen.getByText(/A tenant admin can set it up/)).toBeInTheDocument()
  })
})

describe('what a member can do', () => {
  beforeEach(() => { env.role = 'member'; env.userId = 'user-pat' })

  it('has no way to add a deadline', async () => {
    await openList()
    expect(screen.queryByRole('button', { name: /Add a deadline/ })).not.toBeInTheDocument()
  })

  it('can complete only the deadlines assigned to them', async () => {
    await openList()
    const completeButtons = screen.getAllByRole('button', { name: /^Complete / })
    expect(completeButtons.map(b => b.getAttribute('aria-label'))).toEqual(['Complete Quarterly stormwater inspection'])
  })

  it('sees no edit, dismiss or reopen in a deadline\'s dialog', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Quarterly stormwater inspection' }))
    const dialog = await screen.findByRole('dialog', { name: 'Quarterly stormwater inspection' })
    expect(within(dialog).getByRole('button', { name: /^Complete/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Dismiss/ })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Reopen/ })).not.toBeInTheDocument()
  })

  it('cannot complete anything when nothing is assigned to them', async () => {
    env.userId = 'user-nobody'
    await openList()
    expect(screen.queryByRole('button', { name: /^Complete / })).not.toBeInTheDocument()
  })
})

describe('completing a deadline', () => {
  const finished = deadline({ ...OVERDUE, next_due_at: '2026-12-31' })

  it('sends the exact due date being completed, with the note, then reloads and says when it is next due', async () => {
    completeDeadline.mockResolvedValue({ obligation: finished })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Complete Quarterly stormwater inspection' }))

    const dialog = await screen.findByRole('dialog', { name: 'Quarterly stormwater inspection' })
    await user.type(within(dialog).getByLabelText(/Note/), '  Filed with the water board  ')
    await user.click(within(dialog).getByRole('button', { name: 'Mark complete' }))

    await waitFor(() => expect(completeDeadline).toHaveBeenCalledTimes(1))
    expect(completeDeadline).toHaveBeenCalledWith(SCOPE, 'd-overdue', { occurrence_at: '2026-10-04', note: 'Filed with the water board' })
    expect(await screen.findByText('Quarterly stormwater inspection: marked complete. Next due Dec 31, 2026.')).toBeInTheDocument()
    expect(listDeadlines).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('leaves the note out when none was written', async () => {
    completeDeadline.mockResolvedValue({ obligation: finished })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Complete Renew air permit' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark complete' }))
    await waitFor(() => expect(completeDeadline).toHaveBeenCalled())
    expect(completeDeadline.mock.calls[0]![2]).toEqual({ occurrence_at: '2026-10-19' })
  })

  it('does not promise a next date for a deadline that does not repeat', async () => {
    completeDeadline.mockResolvedValue({ obligation: deadline({ ...OVERDUE, status: 'completed' }) })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Complete Quarterly stormwater inspection' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark complete' }))
    expect(await screen.findByText('Quarterly stormwater inspection: marked complete.')).toBeInTheDocument()
  })

  it('says it changed and reloads, instead of retrying, when the deadline has moved on', async () => {
    completeDeadline.mockRejectedValue(new client.ApiError('This deadline has already moved on.', 409, 'stale', ['This deadline has already moved on.']))
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Complete Quarterly stormwater inspection' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark complete' }))

    expect(await screen.findByText(/changed while you were looking at it/)).toBeInTheDocument()
    expect(completeDeadline).toHaveBeenCalledTimes(1)
    expect(listDeadlines).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('keeps the dialog open and shows the problem when the API refuses', async () => {
    completeDeadline.mockRejectedValue(new client.ApiError('Forbidden', 403, 'owner_or_admin_required', ['Only an admin or the person this deadline is assigned to can complete it.']))
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Complete Quarterly stormwater inspection' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Mark complete' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only an admin or the person this deadline is assigned to can complete it.')
    expect(listDeadlines).toHaveBeenCalledTimes(1)
  })

  it('lets the assigned member complete their own deadline', async () => {
    env.role = 'member'
    env.userId = 'user-me'
    completeDeadline.mockResolvedValue({ obligation: finished })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Complete Renew air permit' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Mark complete' }))
    await waitFor(() => expect(completeDeadline).toHaveBeenCalledWith(SCOPE, 'd-soon', { occurrence_at: '2026-10-19' }))
  })
})

describe('the deadline dialog', () => {
  it('closes on Escape and gives focus back to what opened it', async () => {
    const user = userEvent.setup()
    await openList()
    const opener = screen.getByRole('button', { name: 'Renew air permit' })
    await user.click(opener)
    await screen.findByRole('dialog', { name: 'Renew air permit' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it('shows everything about the deadline', async () => {
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Quarterly stormwater inspection' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Oct 4, 2026 (3 days overdue)')).toBeInTheDocument()
    expect(within(dialog).getByText('Quarterly')).toBeInTheDocument()
    expect(within(dialog).getByText('14 days before it is due')).toBeInTheDocument()
    expect(within(dialog).getByText('Pat Rivera')).toBeInTheDocument()
    expect(within(dialog).getByText('MSGP 3.1')).toBeInTheDocument()
    expect(within(dialog).getByText('Jul 1, 2026')).toBeInTheDocument()
  })

  it('links a library deadline to its checklist', async () => {
    await openList()
    const link = await screen.findByRole('link', { name: 'Run checklist for Quarterly stormwater inspection' })
    expect(link).toHaveAttribute('href', '/environmental/compliance/checklists?start=sw-routine-inspection&obligation=d-overdue')
  })

  it('offers no checklist for a custom deadline or a permit renewal', async () => {
    await openList()
    await screen.findByRole('link', { name: /Run checklist for Quarterly/ })
    expect(screen.getAllByRole('link', { name: /Run checklist/ })).toHaveLength(1)
  })
})

describe('what an admin can change', () => {
  it('edits a deadline\'s title, date, reminder window, reference and program', async () => {
    updateDeadline.mockResolvedValue({ obligation: deadline({ ...OVERDUE, title: 'Quarterly inspection (revised)' }) })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Quarterly stormwater inspection' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit' }))

    const dialog = await screen.findByRole('dialog', { name: 'Edit: Quarterly stormwater inspection' })
    const title = within(dialog).getByLabelText('Title')
    await user.clear(title)
    await user.type(title, 'Quarterly inspection (revised)')
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2026-10-30' } })
    fireEvent.change(within(dialog).getByLabelText(/Reminder window/), { target: { value: '21' } })
    await user.selectOptions(within(dialog).getByLabelText('Program'), 'outfall')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(updateDeadline).toHaveBeenCalledTimes(1))
    expect(updateDeadline).toHaveBeenCalledWith(SCOPE, 'd-overdue', {
      title: 'Quarterly inspection (revised)',
      description: null,
      regulatory_ref: 'MSGP 3.1',
      program: 'outfall',
      next_due_at: '2026-10-30',
      lead_days: 21,
      owner_user_id: 'user-pat',
    })
    expect(await screen.findByText('Quarterly inspection (revised): saved.')).toBeInTheDocument()
    expect(listDeadlines).toHaveBeenCalledTimes(2)
  })

  it('shows the current owner by name in the editor and lets the admin clear it', async () => {
    updateDeadline.mockResolvedValue({ obligation: OVERDUE })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Quarterly stormwater inspection' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: /^Edit:/ })
    expect(within(dialog).getByText('Pat Rivera')).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Clear owner' }))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(updateDeadline).toHaveBeenCalled())
    expect(updateDeadline.mock.calls[0]![2]).toMatchObject({ owner_user_id: null })
  })

  it('dismisses an open deadline', async () => {
    updateDeadline.mockResolvedValue({ obligation: deadline({ ...OVERDUE, status: 'dismissed' }) })
    const user = userEvent.setup()
    await openList()
    await user.click(screen.getByRole('button', { name: 'Quarterly stormwater inspection' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(updateDeadline).toHaveBeenCalledWith(SCOPE, 'd-overdue', { status: 'dismissed' }))
    expect(await screen.findByText('Quarterly stormwater inspection: dismissed.')).toBeInTheDocument()
  })

  it('reopens a dismissed deadline, and offers no Dismiss or Complete on it', async () => {
    const dismissed = deadline({ id: 'd-gone', title: 'Dropped report', status: 'dismissed', next_due_at: '2026-08-01' })
    listDeadlines.mockResolvedValue({ obligations: [dismissed] })
    updateDeadline.mockResolvedValue({ obligation: { ...dismissed, status: 'open' } })
    const user = userEvent.setup()
    await openList()
    expect(screen.queryByRole('button', { name: /^Complete / })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dropped report' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Reopen' }))
    await waitFor(() => expect(updateDeadline).toHaveBeenCalledWith(SCOPE, 'd-gone', { status: 'open' }))
  })
})

describe('adding a deadline', () => {
  const created = deadline({ id: 'd-new', title: 'Landlord inspection' })

  async function openAddDialog(user: ReturnType<typeof userEvent.setup>) {
    await openList()
    await user.click(screen.getByRole('button', { name: /Add a deadline/ }))
    return screen.findByRole('dialog', { name: 'Add a deadline' })
  }

  it('posts a custom repeating deadline for every site, with facility_id null', async () => {
    createDeadline.mockResolvedValue({ obligation: created })
    const user = userEvent.setup()
    const dialog = await openAddDialog(user)

    await user.type(within(dialog).getByLabelText('Title'), 'Landlord inspection')
    await user.selectOptions(within(dialog).getByLabelText('Program'), 'air')
    await user.selectOptions(within(dialog).getByLabelText('Repeats'), 'custom_days')
    fireEvent.change(within(dialog).getByLabelText(/Days between deadlines/), { target: { value: '90' } })
    fireEvent.change(within(dialog).getByLabelText('First due date'), { target: { value: '2026-12-15' } })
    fireEvent.change(within(dialog).getByLabelText(/Reminder window/), { target: { value: '14' } })
    await user.click(within(dialog).getByLabelText(/Due on period end/))
    await user.type(within(dialog).getByLabelText(/Regulatory reference/), 'Lease 4.2')
    await user.type(within(dialog).getByLabelText('Description'), 'Walk the yard with the landlord.')
    await user.click(within(dialog).getByLabelText(/Applies to every site/))
    await user.click(within(dialog).getByRole('button', { name: 'Add deadline' }))

    await waitFor(() => expect(createDeadline).toHaveBeenCalledTimes(1))
    expect(createDeadline).toHaveBeenCalledWith(SCOPE, {
      title: 'Landlord inspection',
      description: 'Walk the yard with the landlord.',
      regulatory_ref: 'Lease 4.2',
      program: 'air',
      next_due_at: '2026-12-15',
      lead_days: 14,
      owner_user_id: null,
      cadence: 'custom_days',
      cadence_days: 90,
      due_anchor: 'period_end',
      facility_id: null,
    })
    expect(await screen.findByText('Landlord inspection: added.')).toBeInTheDocument()
    expect(listDeadlines).toHaveBeenCalledTimes(2)
  })

  it('files a deadline under the open site by default, annual, 30-day reminder, fixed date', async () => {
    createDeadline.mockResolvedValue({ obligation: created })
    const user = userEvent.setup()
    const dialog = await openAddDialog(user)

    await user.type(within(dialog).getByLabelText('Title'), 'Landlord inspection')
    fireEvent.change(within(dialog).getByLabelText('First due date'), { target: { value: '2026-12-15' } })
    expect(within(dialog).queryByLabelText(/Days between deadlines/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add deadline' }))

    await waitFor(() => expect(createDeadline).toHaveBeenCalledTimes(1))
    expect(createDeadline).toHaveBeenCalledWith(SCOPE, {
      title: 'Landlord inspection',
      description: null,
      regulatory_ref: null,
      program: null,
      next_due_at: '2026-12-15',
      lead_days: 30,
      owner_user_id: null,
      cadence: 'annual',
      cadence_days: null,
      due_anchor: 'fixed',
      facility_id: 'f1',
    })
  })

  it('assigns the owner chosen from the account\'s people', async () => {
    createDeadline.mockResolvedValue({ obligation: created })
    const user = userEvent.setup()
    const dialog = await openAddDialog(user)

    await user.type(within(dialog).getByLabelText('Title'), 'Landlord inspection')
    fireEvent.change(within(dialog).getByLabelText('First due date'), { target: { value: '2026-12-15' } })
    await user.click(within(dialog).getByPlaceholderText('Search people…'))
    await user.click(await within(dialog).findByRole('button', { name: /Pat Rivera/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Add deadline' }))

    await waitFor(() => expect(createDeadline).toHaveBeenCalled())
    expect(createDeadline.mock.calls[0]![1]).toMatchObject({ owner_user_id: 'user-pat' })
  })

  it('shows what the API refused, and keeps what was typed', async () => {
    createDeadline.mockRejectedValue(new client.ApiError('Invalid', 400, 'invalid', ['title is required.', 'next_due_at must be a date like 2026-12-31.']))
    const user = userEvent.setup()
    const dialog = await openAddDialog(user)
    await user.type(within(dialog).getByLabelText('Title'), 'Landlord inspection')
    fireEvent.change(within(dialog).getByLabelText('First due date'), { target: { value: '2026-12-15' } })
    await user.click(within(dialog).getByRole('button', { name: 'Add deadline' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('title is required.')
    expect(alert).toHaveTextContent('next_due_at must be a date like 2026-12-31.')
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Landlord inspection')
  })

  describe('from the all-sites roll-up', () => {
    beforeEach(() => { env.facilityId = null })

    it('asks for a site, and will not file the deadline under none', async () => {
      const user = userEvent.setup()
      const dialog = await openAddDialog(user)
      expect(within(dialog).getByText('Choose a site')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Plant A' })).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Add deadline' })).toBeDisabled()
    })

    it('needs no site once the deadline applies to every site', async () => {
      createDeadline.mockResolvedValue({ obligation: created })
      const user = userEvent.setup()
      const dialog = await openAddDialog(user)
      await user.type(within(dialog).getByLabelText('Title'), 'Landlord inspection')
      fireEvent.change(within(dialog).getByLabelText('First due date'), { target: { value: '2026-12-15' } })
      await user.click(within(dialog).getByLabelText(/Applies to every site/))

      expect(within(dialog).queryByText('Choose a site')).not.toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Add deadline' }))
      await waitFor(() => expect(createDeadline).toHaveBeenCalledWith(ROLL_UP_SCOPE, expect.objectContaining({ facility_id: null })))
    })
  })
})
