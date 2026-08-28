// End-to-end scenario for the QR reporting form itself.
//
// incidentReporter.e2e.test.ts drives the route handlers directly, so
// it proves the server behaves — but it cannot catch a client that
// posts the wrong payload. This suite starts one layer higher: it
// renders /report/[token] the way a worker's phone would, taps the
// controls, and lets the page's own fetch reach the real route handler
// through the same in-memory Postgres stand-in. A field name or enum
// value the form gets wrong fails here and nowhere else.
//
// The quick-tap path is the reason this file exists. Its payload used
// to carry incident_type: 'near-miss' — the URL slug of the legacy
// module, not the 'near_miss' value the incidents CHECK constraint
// accepts — so every severity-only submission was rejected with a 400
// while every server-side test passed.

import { vi, describe, it, expect, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  ANON_TOKEN,
  TENANT_ID,
  resetHarness,
  rowsIn,
  seedAnonToken,
  seedTenantWithEmailRule,
} from './_incidentReporterHarness'

vi.mock('next/navigation', () => ({
  useParams:       () => ({ token: ANON_TOKEN }),
  useSearchParams: () => new URLSearchParams(''),
}))

// next/script would inject a real <script> tag; the captcha path is
// covered server-side and this page never needs it under jsdom.
vi.mock('next/script', () => ({ default: () => null }))

vi.mock('@/lib/supabase', () => ({
  supabase: { storage: { from: () => ({ uploadToSignedUrl: async () => ({ error: null }) }) } },
}))

import AnonymousReportPage from '@/app/report/[token]/page'

// Route the page's own fetch calls at the real handlers. Anything the
// page asks for that isn't wired here is a failure, not a fallback.
async function installBrowserNetwork(): Promise<void> {
  const { POST: submitReport } = await import('@/app/api/anonymous-report/route')

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)

    if (url.startsWith('/api/anonymous-report/verify/')) {
      return new Response(JSON.stringify({
        label:                 'Dock B entrance',
        tenant_name:           'Northgate Terminal',
        default_locale:        'en',
        retaliation_statement: null,
        require_captcha:       false,
        turnstile_site_key:    null,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }

    if (url === '/api/anonymous-report') {
      return submitReport(new Request('https://app.example.test/api/anonymous-report', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    String(init?.body ?? '{}'),
      }))
    }

    throw new Error(`unexpected request from the reporting form: ${url}`)
  }))
}

beforeEach(async () => {
  resetHarness()
  seedTenantWithEmailRule()
  seedAnonToken()
  await installBrowserNetwork()
})

// ─── The worker who taps one chip and walks away ────────────────────────

describe('E2E — severity-only quick tap on the QR form', () => {
  it('records the report and shows the worker their report number', async () => {
    const user = userEvent.setup()
    render(<AnonymousReportPage />)

    // The sign resolves first — the worker sees where they are reporting from.
    expect(await screen.findByText('Dock B entrance')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Urgent' }))
    await user.click(screen.getByRole('button', { name: 'Submit anonymously' }))

    expect(await screen.findByText('Thank you')).toBeInTheDocument()
    expect(screen.getByText(/^INC-\d{4}-0001$/)).toBeInTheDocument()
  })

  it('files it as a near miss the incidents table will accept', async () => {
    const user = userEvent.setup()
    render(<AnonymousReportPage />)
    await screen.findByText('Dock B entrance')

    await user.click(screen.getByRole('button', { name: 'Urgent' }))
    await user.click(screen.getByRole('button', { name: 'Submit anonymously' }))

    await waitFor(() => expect(rowsIn('incidents')).toHaveLength(1))
    const [row] = rowsIn('incidents')
    expect(row.incident_type).toBe('near_miss')
    expect(row.severity_potential).toBe('high')
    expect(row.tenant_id).toBe(TENANT_ID)
    expect(row.is_anonymous).toBe(true)
  })

  it('maps the milder chips onto their own potential bands', async () => {
    const user = userEvent.setup()
    render(<AnonymousReportPage />)
    await screen.findByText('Dock B entrance')

    await user.click(screen.getByRole('button', { name: 'Minor' }))
    await user.click(screen.getByRole('button', { name: 'Submit anonymously' }))

    await waitFor(() => expect(rowsIn('incidents')).toHaveLength(1))
    expect(rowsIn('incidents')[0].severity_potential).toBe('low')
  })
})

// ─── The worker who types the whole thing out ───────────────────────────

describe('E2E — typed report on the QR form', () => {
  it('files the chosen type and narrative', async () => {
    const user = userEvent.setup()
    render(<AnonymousReportPage />)
    await screen.findByText('Dock B entrance')

    // With no severity chosen, the detail fields are open by default.
    await user.click(screen.getByRole('radio', { name: 'Environmental spill' }))
    await user.type(
      screen.getByPlaceholderText(/Describe in your own words/i),
      'Coolant leaking from the press onto the walkway.',
    )
    await user.click(screen.getByRole('button', { name: 'Submit anonymously' }))

    await waitFor(() => expect(rowsIn('incidents')).toHaveLength(1))
    const [row] = rowsIn('incidents')
    expect(row.incident_type).toBe('environmental')
    expect(row.description).toBe('Coolant leaking from the press onto the walkway.')
  })

  it('asks for a type before it will post anything', async () => {
    const user = userEvent.setup()
    render(<AnonymousReportPage />)
    await screen.findByText('Dock B entrance')

    await user.type(
      screen.getByPlaceholderText(/Describe in your own words/i),
      'Something happened but I did not say what kind.',
    )
    await user.click(screen.getByRole('button', { name: 'Submit anonymously' }))

    expect(await screen.findByText('Please pick an incident type.')).toBeInTheDocument()
    expect(rowsIn('incidents')).toHaveLength(0)
  })
})

// ─── The worker who wants to check back later ───────────────────────────

describe('E2E — receipt opt-in on the QR form', () => {
  it('shows the tracking code once when the worker asks for one', async () => {
    const user = userEvent.setup()
    render(<AnonymousReportPage />)
    await screen.findByText('Dock B entrance')

    await user.click(screen.getByRole('button', { name: 'Concerning' }))
    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: 'Submit anonymously' }))

    expect(await screen.findByText('Your tracking code')).toBeInTheDocument()
    await waitFor(() => expect(rowsIn('incidents')[0].anon_receipt_hash).toEqual(expect.any(String)))
  })
})
