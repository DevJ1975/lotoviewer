import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import EnvironmentalLegalRegister from '@/app/environmental/compliance/legal/page'
import {
  ApiError, createLegal, deleteLegal, evaluateLegal, listLegal, reviewLegal, searchOwners, updateLegal,
  type LegalEntry, type Scope, type SiteDetail,
} from '@/lib/environmental/client'
import { evidenceUrl } from '@/lib/environmental/evidence'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { useFacility } from '@/components/FacilityProvider'

// The page's collaborators are replaced at their edges: the typed API client, the
// providers behind the hooks, and the library (for a Verify note the test controls).
// The page, its dialogs and the pure view module run for real.

vi.mock('@/lib/environmental/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/environmental/client')>(),
  listLegal: vi.fn(), createLegal: vi.fn(), updateLegal: vi.fn(), deleteLegal: vi.fn(),
  evaluateLegal: vi.fn(), reviewLegal: vi.fn(), searchOwners: vi.fn(),
}))
vi.mock('@/lib/environmental/evidence', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/environmental/evidence')>(),
  evidenceUrl: vi.fn(),
}))
vi.mock('@/lib/environmental/useEnvironmental', () => ({ useEnvironmentalScope: vi.fn(), useEnvironmentalSite: vi.fn() }))
vi.mock('@/components/FacilityProvider', () => ({ useFacility: vi.fn() }))
vi.mock('next/navigation', () => ({ usePathname: () => '/environmental/compliance/legal' }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@soteria/core/environmental/packs/index', async importActual => {
  const actual = await importActual<typeof import('@soteria/core/environmental/packs/index')>()
  const legal = [{ id: 'lr-test-noted', verify: 'Confirm the sector for this facility.' }, { id: 'lr-test-clean' }]
  return {
    ...actual,
    libraryForState: (state: string | null) => {
      const site = actual.libraryForState(state)
      return { ...site, library: { ...site.library, legal } }
    },
  }
})

const SITE_SCOPE: Scope = { tenantId: 'tenant-1', facilityId: 'f-1' }
const ROLL_UP_SCOPE: Scope = { tenantId: 'tenant-1', facilityId: null }

const SITE = {
  facility: { id: 'f-1', name: 'Plant 1', state: 'CA' },
  jurisdiction: { chain: ['federal', 'CA'], state: 'CA', status: 'supported' },
  notice: null,
  packs: [{ jurisdiction: 'federal', version: '1', status: 'draft', last_verified: null }],
} as unknown as SiteDetail

const FACILITIES = [{ id: 'f-1', name: 'Plant 1' }, { id: 'f-2', name: 'Plant 2' }]

function asSite({ canAdmin = true } = {}) {
  vi.mocked(useEnvironmentalScope).mockReturnValue({ scope: SITE_SCOPE, facilityId: 'f-1', facilityName: 'Plant 1', canAdmin, ready: true })
  vi.mocked(useEnvironmentalSite).mockReturnValue({ site: SITE, loading: false, error: null, reload: vi.fn(), setSite: vi.fn() })
  vi.mocked(useFacility).mockReturnValue({ available: FACILITIES, facilityId: 'f-1' } as unknown as ReturnType<typeof useFacility>)
}

function asRollUp() {
  vi.mocked(useEnvironmentalScope).mockReturnValue({ scope: ROLL_UP_SCOPE, facilityId: null, facilityName: null, canAdmin: true, ready: true })
  vi.mocked(useEnvironmentalSite).mockReturnValue({ site: null, loading: false, error: null, reload: vi.fn(), setSite: vi.fn() })
  vi.mocked(useFacility).mockReturnValue({ available: FACILITIES, facilityId: null } as unknown as ReturnType<typeof useFacility>)
}

function legalEntry(overrides: Partial<LegalEntry>): LegalEntry {
  return {
    id: 'e-0', facility_id: 'f-1', title: 'Untitled', citation: 'Citation', jurisdiction: 'federal', authority: null, summary: null,
    applicability_note: null, source_url: null, effective_date: null, review_frequency: 'annual',
    last_reviewed_at: '2026-01-15T10:00:00Z', next_review_due: '2027-01-15', program: 'air', library_key: null,
    applicability: 'applicable', compliance_status: 'not_evaluated', last_evaluated_at: null, evaluation_note: null,
    evidence_path: null, owner_user_id: null, source: 'tenant', review: 'ok',
    ...overrides,
  }
}

// A library entry with a Verify note, failing and overdue; owned by someone we can name.
const PERMIT = legalEntry({
  id: 'e-permit', title: 'Industrial stormwater permit', citation: 'EPA MSGP', program: 'stormwater', library_key: 'lr-test-noted',
  source: 'library', compliance_status: 'non_compliant', evaluation_note: 'Quarterly sampling was missed.', review: 'overdue',
  next_review_due: '2026-05-01', owner_user_id: 'u-ana', source_url: 'https://www.epa.gov/npdes', evidence_path: 'tenant-1/legal/sampling.pdf',
  summary: 'Permit coverage and a plan to keep pollutants out of runoff.', applicability_note: 'Applies where materials are exposed.',
  authority: 'US EPA', last_evaluated_at: '2026-08-02T15:00:00Z',
})
// A library entry with no Verify note, compliant, owned by someone the owner lookup cannot name.
const WASTE = legalEntry({
  id: 'e-waste', title: 'Hazardous waste generator standards', citation: '40 CFR Part 262', program: 'hazardous_waste', library_key: 'lr-test-clean',
  source: 'library', compliance_status: 'compliant', applicability: 'applicable', review: 'ok', next_review_due: '2026-11-01',
  owner_user_id: '0b6f2c1e-1111-4222-8333-444455556666',
})
// A custom entry that covers every site: no library key, so no Verify note.
const NOISE = legalEntry({
  id: 'e-noise', title: 'City noise ordinance', citation: 'Municipal Code 8.20', jurisdiction: 'CA', program: null, library_key: null,
  facility_id: null, applicability: 'under_review', compliance_status: 'not_evaluated', review: 'never_reviewed',
  last_reviewed_at: null, next_review_due: null,
})

const user = userEvent.setup()

function showEntries(entries: LegalEntry[]) {
  vi.mocked(listLegal).mockResolvedValue({ entries })
}

async function renderRegister() {
  render(<EnvironmentalLegalRegister />)
  await screen.findByRole('table')
}

const rowButton = (title: RegExp) => screen.findByRole('button', { name: title })
const openRow = async (title: RegExp) => { await user.click(await rowButton(title)) }
const tile = (name: string) => within(screen.getByRole('list', { name: 'Register summary' })).getByRole('button', { name })

beforeEach(() => {
  vi.resetAllMocks()
  asSite()
  showEntries([PERMIT, WASTE, NOISE])
  vi.mocked(evidenceUrl).mockResolvedValue('https://signed.example/evidence.pdf')
  vi.mocked(searchOwners).mockResolvedValue([{ user_id: 'u-ana', display_name: 'Ana Ruiz', email: 'ana@example.com' }])
})

describe('the legal register', () => {
  it('lists each requirement with its chips, owner by name, and the jurisdiction banner', async () => {
    await renderRegister()

    expect(screen.getByText('Federal + CA')).toBeInTheDocument()
    expect(listLegal).toHaveBeenCalledWith(SITE_SCOPE)

    const permitRow = screen.getByRole('row', { name: /Industrial stormwater permit/ })
    for (const text of ['Federal', 'Stormwater', 'Non-compliant', 'Applicable', 'Overdue since 2026-05-01', 'Ana Ruiz']) {
      expect(within(permitRow).getByText(text), text).toBeInTheDocument()
    }
    const noiseRow = screen.getByRole('row', { name: /City noise ordinance/ })
    for (const text of ['CA', 'Not evaluated', 'Under review', 'Never reviewed', 'All sites']) {
      expect(within(noiseRow).getByText(text), text).toBeInTheDocument()
    }
    expect(within(screen.getByRole('row', { name: /Hazardous waste generator/ })).getByText('Review due 2026-11-01')).toBeInTheDocument()
  })

  it('shows "Assigned" for an owner it cannot name, never the id', async () => {
    await renderRegister()
    expect(within(screen.getByRole('row', { name: /Hazardous waste generator/ })).getByText('Assigned')).toBeInTheDocument()
    expect(screen.queryByText(/0b6f2c1e/)).not.toBeInTheDocument()
  })

  it('puts what is failing first, then the rest by title', async () => {
    await renderRegister()
    const order = within(screen.getByRole('table')).getAllByRole('button').map(b => b.textContent ?? '')
    expect(order).toEqual([
      expect.stringMatching(/^Industrial stormwater permit/),
      expect.stringMatching(/^City noise ordinance/),
      expect.stringMatching(/^Hazardous waste generator standards/),
    ])
  })

  it('summarises the register, counting a requirement that does not apply as settled', async () => {
    showEntries([PERMIT, WASTE, NOISE, legalEntry({ id: 'e-na', title: 'Not for us', applicability: 'not_applicable' })])
    await renderRegister()

    expect(tile('Compliant: 1')).toBeInTheDocument()
    expect(tile('Needs attention: 0')).toBeInTheDocument()
    expect(tile('Non-compliant: 1')).toBeInTheDocument()
    expect(tile('Not evaluated: 1')).toBeInTheDocument()
    expect(tile('Under review: 1')).toBeInTheDocument()
    expect(tile('Reviews overdue: 1')).toBeInTheDocument()
  })

  it('shows no Site column for a single site', async () => {
    await renderRegister()
    expect(screen.queryByRole('columnheader', { name: 'Site' })).not.toBeInTheDocument()
  })

  describe('filters', () => {
    it('applies a count when it is clicked, and lifts it when it is clicked again', async () => {
      await renderRegister()

      await user.click(tile('Non-compliant: 1'))
      expect(tile('Non-compliant: 1')).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText('Showing 1 of 3 requirements')).toBeInTheDocument()
      expect(screen.getByRole('row', { name: /Industrial stormwater permit/ })).toBeInTheDocument()
      expect(screen.queryByRole('row', { name: /City noise ordinance/ })).not.toBeInTheDocument()

      await user.click(tile('Non-compliant: 1'))
      expect(screen.getByText('Showing 3 of 3 requirements')).toBeInTheDocument()
    })

    it('filters by program, applicability, compliance status and review state, and leaves the counts alone', async () => {
      await renderRegister()

      await user.selectOptions(screen.getByLabelText('Program'), 'hazardous_waste')
      expect(screen.getByText('Showing 1 of 3 requirements')).toBeInTheDocument()
      expect(screen.getByRole('row', { name: /Hazardous waste generator/ })).toBeInTheDocument()
      expect(tile('Non-compliant: 1')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      await user.selectOptions(screen.getByLabelText('Applicability'), 'under_review')
      expect(screen.getByRole('row', { name: /City noise ordinance/ })).toBeInTheDocument()
      expect(screen.queryByRole('row', { name: /Industrial stormwater permit/ })).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      await user.selectOptions(screen.getByLabelText('Compliance'), 'compliant')
      expect(screen.getByText('Showing 1 of 3 requirements')).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      await user.selectOptions(screen.getByLabelText('Review'), 'never_reviewed')
      expect(screen.getByRole('row', { name: /City noise ordinance/ })).toBeInTheDocument()
      expect(screen.getByText('Showing 1 of 3 requirements')).toBeInTheDocument()
    })

    it('searches the title, citation and summary', async () => {
      await renderRegister()
      const search = screen.getByRole('searchbox', { name: /Search/ })

      await user.type(search, 'part 262')
      expect(screen.getByRole('row', { name: /Hazardous waste generator/ })).toBeInTheDocument()
      expect(screen.getByText('Showing 1 of 3 requirements')).toBeInTheDocument()

      await user.clear(search)
      await user.type(search, 'runoff')
      expect(screen.getByRole('row', { name: /Industrial stormwater permit/ })).toBeInTheDocument()
      expect(screen.getByText('Showing 1 of 3 requirements')).toBeInTheDocument()
    })

    it('says so when nothing matches, and offers to clear the filters', async () => {
      await renderRegister()
      await user.type(screen.getByRole('searchbox', { name: /Search/ }), 'no such requirement')

      expect(screen.getByText('No requirements match these filters.')).toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'Clear filters' }))
      expect(screen.getByText('Showing 3 of 3 requirements')).toBeInTheDocument()
    })

    it('filters in the page, without asking the server again', async () => {
      await renderRegister()
      await user.click(tile('Non-compliant: 1'))
      await user.selectOptions(screen.getByLabelText('Program'), 'stormwater')
      expect(listLegal).toHaveBeenCalledTimes(1)
    })
  })

  describe('an expanded requirement', () => {
    it('shows its detail, with the source and evidence as safe links', async () => {
      await renderRegister()
      await openRow(/Industrial stormwater permit/)

      const toggle = screen.getByRole('button', { name: /Industrial stormwater permit/ })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(screen.getByText('Permit coverage and a plan to keep pollutants out of runoff.')).toBeInTheDocument()
      expect(screen.getByText('Applies where materials are exposed.')).toBeInTheDocument()
      expect(screen.getByText('Quarterly sampling was missed.')).toBeInTheDocument()
      expect(screen.getByText('US EPA')).toBeInTheDocument()
      expect(screen.getByText('2026-08-02')).toBeInTheDocument()

      const source = screen.getByRole('link', { name: /Read the source/ })
      expect(source).toHaveAttribute('href', 'https://www.epa.gov/npdes')
      expect(source).toHaveAttribute('target', '_blank')
      expect(source).toHaveAttribute('rel', 'noopener noreferrer')

      const evidence = await screen.findByRole('link', { name: /View evidence/ })
      expect(evidence).toHaveAttribute('href', 'https://signed.example/evidence.pdf')
      expect(evidence).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('shows the library\'s Verify note on a library entry that has one, and none on one that does not or on a custom entry', async () => {
      await renderRegister()

      await openRow(/Industrial stormwater permit/)
      expect(screen.getByText('Verify:')).toBeInTheDocument()
      expect(screen.getByText(/Confirm the sector for this facility\./)).toBeInTheDocument()

      await openRow(/Hazardous waste generator/)
      expect(screen.queryByText('Verify:')).not.toBeInTheDocument()

      await openRow(/City noise ordinance/)
      expect(screen.queryByText('Verify:')).not.toBeInTheDocument()
    })

    it('does not make a link out of an address that is not a web page', async () => {
      showEntries([legalEntry({ id: 'e-bad', title: 'Odd source', source_url: 'javascript:alert(1)' })])
      await renderRegister()
      await openRow(/Odd source/)
      expect(screen.queryByRole('link', { name: /Read the source/ })).not.toBeInTheDocument()
    })

    it('opens one at a time', async () => {
      await renderRegister()
      await openRow(/Industrial stormwater permit/)
      await openRow(/Hazardous waste generator/)
      expect(screen.getByRole('button', { name: /Industrial stormwater permit/ })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.getByRole('button', { name: /Hazardous waste generator/ })).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('as a member', () => {
    beforeEach(() => asSite({ canAdmin: false }))

    it('sees no admin controls and is told why', async () => {
      await renderRegister()
      await openRow(/Industrial stormwater permit/)

      expect(screen.getByText('Only a tenant admin can change the register.')).toBeInTheDocument()
      for (const name of ['Add a requirement', 'Evaluate', 'Mark reviewed', 'Edit', 'Delete']) {
        expect(screen.queryByRole('button', { name }), name).not.toBeInTheDocument()
      }
    })

    it('can still read, filter and expand', async () => {
      await renderRegister()
      await user.click(tile('Non-compliant: 1'))
      await openRow(/Industrial stormwater permit/)
      expect(screen.getByText('Quarterly sampling was missed.')).toBeInTheDocument()
    })
  })

  describe('evaluating', () => {
    async function openEvaluate(title: RegExp) {
      await openRow(title)
      await user.click(screen.getByRole('button', { name: 'Evaluate' }))
      return screen.findByRole('dialog', { name: 'Evaluate requirement' })
    }

    it('posts the rating and note, then closes and reloads the register', async () => {
      vi.mocked(evaluateLegal).mockResolvedValue({ entry: NOISE })
      await renderRegister()
      const dialog = await openEvaluate(/City noise ordinance/)

      await user.selectOptions(within(dialog).getByLabelText('Applicability'), 'applicable')
      await user.selectOptions(within(dialog).getByLabelText(/Compliance status/), 'attention')
      await user.type(within(dialog).getByLabelText(/Note/), '  Two complaints this quarter  ')
      await user.click(within(dialog).getByRole('button', { name: 'Save evaluation' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(evaluateLegal).toHaveBeenCalledWith(SITE_SCOPE, 'e-noise', {
        applicability: 'applicable', compliance_status: 'attention', note: 'Two complaints this quarter',
      })
      expect(screen.getByText(/Saved the evaluation of “City noise ordinance”\./)).toBeInTheDocument()
      expect(listLegal).toHaveBeenCalledTimes(2)
    })

    it('shows the API\'s own words when it refuses, and keeps the dialog and what was typed', async () => {
      const refusal = 'Say what is wrong: a rating of attention or non_compliant needs a note.'
      vi.mocked(evaluateLegal).mockRejectedValue(new ApiError(refusal, 400, 'invalid', [refusal]))
      await renderRegister()
      const dialog = await openEvaluate(/City noise ordinance/)

      await user.selectOptions(within(dialog).getByLabelText(/Compliance status/), 'non_compliant')
      await user.click(within(dialog).getByRole('button', { name: 'Save evaluation' }))

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(refusal)
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(within(dialog).getByLabelText(/Compliance status/)).toHaveValue('non_compliant')
      expect(listLegal).toHaveBeenCalledTimes(1)
    })

    it('cannot rate a requirement that does not apply, says why, and sends "not evaluated"', async () => {
      vi.mocked(evaluateLegal).mockResolvedValue({ entry: PERMIT })
      await renderRegister()
      const dialog = await openEvaluate(/Industrial stormwater permit/)
      const status = within(dialog).getByLabelText(/Compliance status/)
      expect(status).toHaveValue('non_compliant')
      expect(status).toBeEnabled()

      await user.selectOptions(within(dialog).getByLabelText('Applicability'), 'not_applicable')

      expect(status).toBeDisabled()
      expect(status).toHaveValue('not_evaluated')
      expect(within(dialog).getByText(/does not apply is not rated/)).toBeInTheDocument()

      await user.click(within(dialog).getByRole('button', { name: 'Save evaluation' }))
      await waitFor(() => expect(evaluateLegal).toHaveBeenCalled())
      expect(evaluateLegal).toHaveBeenCalledWith(SITE_SCOPE, 'e-permit', {
        applicability: 'not_applicable', compliance_status: 'not_evaluated', note: 'Quarterly sampling was missed.',
      })
    })

    it('starts from the current evaluation and leaves existing evidence out of the request', async () => {
      vi.mocked(evaluateLegal).mockResolvedValue({ entry: PERMIT })
      await renderRegister()
      const dialog = await openEvaluate(/Industrial stormwater permit/)
      expect(within(dialog).getByLabelText('Applicability')).toHaveValue('applicable')
      expect(within(dialog).getByLabelText(/Note/)).toHaveValue('Quarterly sampling was missed.')

      await user.click(within(dialog).getByRole('button', { name: 'Save evaluation' }))
      await waitFor(() => expect(evaluateLegal).toHaveBeenCalled())
      expect(vi.mocked(evaluateLegal).mock.calls[0]![2]).not.toHaveProperty('evidence_path')
    })

    it('closes on Escape, keeps focus inside while open, and returns focus to the button that opened it', async () => {
      await renderRegister()
      const dialog = await openEvaluate(/City noise ordinance/)
      expect(dialog.contains(document.activeElement)).toBe(true)

      await user.keyboard('{Escape}')

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(evaluateLegal).not.toHaveBeenCalled()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Evaluate' })).toHaveFocus())
    })
  })

  describe('marking reviewed', () => {
    it('records the review in one click and says when the next one is due', async () => {
      vi.mocked(reviewLegal).mockResolvedValue({ entry: { ...WASTE, next_review_due: '2027-10-07' } })
      await renderRegister()
      await openRow(/Hazardous waste generator/)

      await user.click(screen.getByRole('button', { name: 'Mark reviewed' }))

      expect(reviewLegal).toHaveBeenCalledWith(SITE_SCOPE, 'e-waste')
      expect(await screen.findByText('Marked “Hazardous waste generator standards” as reviewed. The next review is due 2027-10-07.')).toBeInTheDocument()
      expect(listLegal).toHaveBeenCalledTimes(2)
    })

    it('shows the API\'s message when the review is refused', async () => {
      vi.mocked(reviewLegal).mockRejectedValue(new ApiError('That record no longer exists.', 404, 'not_found', []))
      await renderRegister()
      await openRow(/Hazardous waste generator/)

      await user.click(screen.getByRole('button', { name: 'Mark reviewed' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('That record no longer exists.')
    })
  })

  describe('adding a requirement', () => {
    async function openAdd() {
      await user.click(screen.getByRole('button', { name: 'Add a requirement' }))
      return screen.findByRole('dialog', { name: 'Add a requirement' })
    }

    async function fillRequired(dialog: HTMLElement) {
      await user.type(within(dialog).getByLabelText(/^Title/), 'Local air rule')
      await user.type(within(dialog).getByLabelText(/^Citation/), 'Rule 4')
    }

    it('sends facility_id null when it applies to every site', async () => {
      vi.mocked(createLegal).mockResolvedValue({ entry: NOISE })
      await renderRegister()
      const dialog = await openAdd()

      await fillRequired(dialog)
      await user.click(within(dialog).getByRole('checkbox', { name: /Applies to every site/ }))
      await user.click(within(dialog).getByRole('button', { name: 'Add requirement' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(createLegal).toHaveBeenCalledWith(SITE_SCOPE, {
        title: 'Local air rule', citation: 'Rule 4', jurisdiction: 'CA', authority: '', summary: '', applicability_note: '',
        source_url: '', effective_date: '', review_frequency: '', program: '', owner_user_id: null, facility_id: null,
      })
      expect(screen.getByText('Added “Local air rule” to the register.')).toBeInTheDocument()
      expect(listLegal).toHaveBeenCalledTimes(2)
    })

    it('adds to the active site when "applies to every site" is left unchecked', async () => {
      vi.mocked(createLegal).mockResolvedValue({ entry: NOISE })
      await renderRegister()
      const dialog = await openAdd()

      expect(within(dialog).getByRole('checkbox', { name: /Applies to every site/ })).not.toBeChecked()
      expect(within(dialog).getByText(/Leave unchecked to add it to Plant 1 only\./)).toBeInTheDocument()
      await fillRequired(dialog)
      await user.selectOptions(within(dialog).getByLabelText('Jurisdiction'), 'federal')
      await user.selectOptions(within(dialog).getByLabelText('Program'), 'air')
      await user.selectOptions(within(dialog).getByLabelText(/Review frequency/), 'biennial')
      await user.click(within(dialog).getByRole('button', { name: 'Add requirement' }))

      await waitFor(() => expect(createLegal).toHaveBeenCalled())
      expect(createLegal).toHaveBeenCalledWith(SITE_SCOPE, expect.objectContaining({
        jurisdiction: 'federal', program: 'air', review_frequency: 'biennial', facility_id: 'f-1',
      }))
    })

    it('shows every problem the API reports and keeps the form', async () => {
      const problems = ['title is required.', 'citation is required.']
      vi.mocked(createLegal).mockRejectedValue(new ApiError(problems[0]!, 400, 'invalid', problems))
      await renderRegister()
      const dialog = await openAdd()

      await user.click(within(dialog).getByRole('button', { name: 'Add requirement' }))

      const alert = await within(dialog).findByRole('alert')
      expect(alert).toHaveTextContent('title is required.')
      expect(alert).toHaveTextContent('citation is required.')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })

  describe('editing and deleting', () => {
    it('edits the description from what is stored, and does not move the entry to another site', async () => {
      vi.mocked(updateLegal).mockResolvedValue({ entry: PERMIT })
      await renderRegister()
      await openRow(/Industrial stormwater permit/)
      await user.click(screen.getByRole('button', { name: 'Edit' }))
      const dialog = await screen.findByRole('dialog', { name: 'Edit requirement' })

      expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('Industrial stormwater permit')
      expect(within(dialog).queryByRole('checkbox', { name: /Applies to every site/ })).not.toBeInTheDocument()
      await user.clear(within(dialog).getByLabelText(/^Title/))
      await user.type(within(dialog).getByLabelText(/^Title/), 'Stormwater permit (MSGP)')
      await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

      await waitFor(() => expect(updateLegal).toHaveBeenCalled())
      const [scope, id, body] = vi.mocked(updateLegal).mock.calls[0]!
      expect(scope).toBe(SITE_SCOPE)
      expect(id).toBe('e-permit')
      expect(body).toMatchObject({ title: 'Stormwater permit (MSGP)', citation: 'EPA MSGP', program: 'stormwater', owner_user_id: 'u-ana' })
      expect(body).not.toHaveProperty('facility_id')
      expect(body).not.toHaveProperty('compliance_status')
    })

    it('asks before deleting, and does nothing when cancelled', async () => {
      await renderRegister()
      await openRow(/City noise ordinance/)
      await user.click(screen.getByRole('button', { name: 'Delete' }))

      const dialog = await screen.findByRole('dialog', { name: 'Delete this requirement?' })
      expect(dialog).toHaveTextContent('for every site')
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(deleteLegal).not.toHaveBeenCalled()
    })

    it('deletes, reloads, and shows the warning the API gives for a library entry', async () => {
      const warning = 'This entry came from the library. Applying the library again will bring it back.'
      vi.mocked(deleteLegal).mockResolvedValue({ ok: true, warning })
      await renderRegister()
      await openRow(/Hazardous waste generator/)
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      const dialog = await screen.findByRole('dialog', { name: 'Delete this requirement?' })

      await user.click(within(dialog).getByRole('button', { name: 'Delete' }))

      expect(deleteLegal).toHaveBeenCalledWith(SITE_SCOPE, 'e-waste')
      expect(await screen.findByText(`Deleted “Hazardous waste generator standards”. ${warning}`)).toBeInTheDocument()
      expect(listLegal).toHaveBeenCalledTimes(2)
    })

    it('deletes a custom entry with no warning to show', async () => {
      vi.mocked(deleteLegal).mockResolvedValue({ ok: true })
      await renderRegister()
      await openRow(/City noise ordinance/)
      await user.click(screen.getByRole('button', { name: 'Delete' }))
      await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))

      expect(await screen.findByText('Deleted “City noise ordinance”.')).toBeInTheDocument()
    })
  })

  describe('with all sites selected', () => {
    beforeEach(() => {
      asRollUp()
      showEntries([
        legalEntry({ id: 'r-1', title: 'Plant 1 air permit', facility_id: 'f-1' }),
        legalEntry({ id: 'r-2', title: 'Plant 2 air permit', facility_id: 'f-2' }),
        legalEntry({ id: 'r-3', title: 'Company-wide policy', facility_id: null }),
        legalEntry({ id: 'r-4', title: 'Former plant permit', facility_id: 'f-gone' }),
      ])
    })

    it('adds a Site column naming each entry\'s site, "All sites" for a company-wide one, and never an id', async () => {
      await renderRegister()

      expect(screen.getByRole('columnheader', { name: 'Site' })).toBeInTheDocument()
      expect(listLegal).toHaveBeenCalledWith(ROLL_UP_SCOPE)
      const cellOf = (title: RegExp) => within(screen.getByRole('row', { name: title })).getAllByRole('cell')[1]!
      expect(cellOf(/Plant 1 air permit/)).toHaveTextContent('Plant 1')
      expect(cellOf(/Plant 2 air permit/)).toHaveTextContent('Plant 2')
      expect(cellOf(/Company-wide policy/)).toHaveTextContent('All sites')
      expect(cellOf(/Former plant permit/)).toHaveTextContent('Unknown site')
      expect(screen.queryByText(/f-gone/)).not.toBeInTheDocument()
      expect(screen.queryByText('Federal + CA')).not.toBeInTheDocument()
    })

    it('can only add a requirement that applies to every site', async () => {
      vi.mocked(createLegal).mockResolvedValue({ entry: NOISE })
      await renderRegister()
      await user.click(screen.getByRole('button', { name: 'Add a requirement' }))
      const dialog = await screen.findByRole('dialog', { name: 'Add a requirement' })

      const everySite = within(dialog).getByRole('checkbox', { name: /Applies to every site/ })
      expect(everySite).toBeChecked()
      expect(everySite).toBeDisabled()
      await user.type(within(dialog).getByLabelText(/^Title/), 'Company policy')
      await user.type(within(dialog).getByLabelText(/^Citation/), 'Policy 1')
      await user.click(within(dialog).getByRole('button', { name: 'Add requirement' }))

      await waitFor(() => expect(createLegal).toHaveBeenCalled())
      expect(createLegal).toHaveBeenCalledWith(ROLL_UP_SCOPE, expect.objectContaining({ jurisdiction: 'federal', facility_id: null }))
    })
  })

  describe('when there is nothing to show', () => {
    beforeEach(() => showEntries([]))

    it('points an admin to the library setup on the Overview page', async () => {
      render(<EnvironmentalLegalRegister />)
      const link = await screen.findByRole('link', { name: 'Set up this site from the library' })
      expect(link).toHaveAttribute('href', '/environmental/compliance')
      expect(screen.getByRole('button', { name: 'Add a requirement' })).toBeInTheDocument()
      expect(screen.queryByRole('table')).not.toBeInTheDocument()
    })

    it('tells a member that an admin sets it up, without a link they could not use', async () => {
      asSite({ canAdmin: false })
      render(<EnvironmentalLegalRegister />)
      expect(await screen.findByText('A tenant admin can set the register up.')).toBeInTheDocument()
      expect(screen.queryByRole('link', { name: /library/ })).not.toBeInTheDocument()
    })
  })

  describe('loading', () => {
    it('shows a spinner until the context is ready', () => {
      vi.mocked(useEnvironmentalScope).mockReturnValue({ scope: null, facilityId: null, facilityName: null, canAdmin: false, ready: false })
      render(<EnvironmentalLegalRegister />)
      expect(screen.getByRole('status')).toBeInTheDocument()
      expect(listLegal).not.toHaveBeenCalled()
    })

    it('shows the problem, and no spinner, when the register cannot be loaded', async () => {
      vi.mocked(listLegal).mockRejectedValue(new ApiError('Request failed (500)', 500, null, []))
      render(<EnvironmentalLegalRegister />)
      expect(await screen.findByRole('alert')).toHaveTextContent('Request failed (500)')
      expect(screen.queryByRole('status')).not.toBeInTheDocument()
    })

    it('still lists the register when the owner names cannot be loaded', async () => {
      vi.mocked(searchOwners).mockRejectedValue(new Error('offline'))
      await renderRegister()
      expect(within(screen.getByRole('row', { name: /Industrial stormwater permit/ })).getByText('Assigned')).toBeInTheDocument()
    })
  })
})
