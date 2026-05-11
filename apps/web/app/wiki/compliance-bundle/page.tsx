import Link from 'next/link'
import WikiPage, { Section, Faq, DoDont, Related, type ChangelogEntry } from '../_components/WikiPage'

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

const CHANGELOG: ChangelogEntry[] = [
  { version: '1.0.0', date: '2026-05-05', changes: ['Initial compliance-bundle wiki page.'] },
]

export default function WikiCompliancePage() {
  return (
    <WikiPage
      title="Compliance Bundle"
      subtitle="Single-PDF audit export for a date range, with chain-of-custody hashes."
      modulePath="/admin/compliance-bundle"
      audience="admin"
      category="Reports"
      version={CURRENT_VERSION}
      lastUpdated={LAST_UPDATED}
      changelog={CHANGELOG}
      toc={[
        { id: 'overview',   label: 'What it\'s for' },
        { id: 'contents',   label: 'What\'s inside' },
        { id: 'faq',        label: 'FAQ' },
        { id: 'dodonts',    label: 'Do\'s & Don\'ts' },
        { id: 'related',    label: 'Related modules' },
      ]}
    >
      <Section id="overview" title="What it's for">
        <p>
          Generate a single PDF that contains every signed permit, atmospheric
          test, and review for a chosen date range, with a SHA-256 hash for
          each underlying document on the cover sheet. Hand it to an OSHA
          inspector or attach it to a customer audit response.
        </p>
      </Section>

      <Section id="contents" title="What's inside">
        <ul>
          <li>Cover sheet with the date range, tenant, and SHA-256 chain-of-custody hashes.</li>
          <li>Confined-space permits + atmospheric tests for the period.</li>
          <li>Hot-work permits with state transitions and signoffs.</li>
          <li>Signed LOTO placards (where re-printed in the period).</li>
          <li>Risk register snapshot at the bundle&apos;s end-date.</li>
          <li>Near-miss reports and their resolutions.</li>
        </ul>
      </Section>

      <Section id="faq" title="Frequently asked questions">
        <Faq items={[
          {
            q: 'How long does generating a bundle take?',
            a: <>Client-side, depending on the date range and the number of
              attached PDFs: ~10s for a week, ~30s for a quarter, ~2 minutes
              for a year. The progress indicator stays accurate; don&apos;t
              close the tab.</>,
          },
          {
            q: 'Why client-side instead of a server-built archive?',
            a: <>The signed PDFs are already in your browser&apos;s cache after
              the period&apos;s normal use, so client-side merge is faster and
              the server stays stateless. It also avoids a long-running
              serverless function.</>,
          },
          {
            q: 'What do the SHA-256 hashes prove?',
            a: <>That the PDFs included in the bundle are byte-for-byte
              identical to the ones stored at the time of signing. An auditor
              can verify any single document&apos;s hash against the cover
              sheet to detect tampering.</>,
          },
          {
            q: 'Can I generate one bundle per department?',
            a: <>Not directly. Generate the full bundle for the period, then
              if a department-specific export is needed, pull the CSV view
              from each underlying module.</>,
          },
          {
            q: 'Is the bundle stored anywhere?',
            a: <>No — it&apos;s downloaded straight to your browser. Save it
              to your retention store (SharePoint, S3, etc.) immediately. The
              act of generating it is logged at{' '}
              <Link href="/admin/audit">/admin/audit</Link>.</>,
          },
          {
            q: 'My bundle is huge — can I split it?',
            a: <>Pick a smaller date range. There&apos;s no built-in splitter;
              that&apos;s deliberate so the cover-sheet hash chain stays
              one document.</>,
          },
          {
            q: 'Can a non-admin generate a bundle?',
            a: <>No — bundle generation requires <code>is_admin</code>. RLS
              also enforces this server-side; clicking the link as a
              non-admin would 403 even if you knew the URL.</>,
          },
        ]} />
      </Section>

      <Section id="dodonts" title="Do's & Don'ts">
        <DoDont
          dos={[
            'Generate quarterly bundles on a fixed cadence so the chain of evidence is always within reach.',
            'Save the bundle to your immutable retention store the moment it downloads.',
            'Verify a sample of hashes against the original PDFs at least once a year — the check exists to be used.',
            'Include the bundle in your customer audit-response template.',
          ]}
          donts={[
            'Don\'t edit the PDF after download. Even adding bookmarks invalidates every embedded hash.',
            'Don\'t share the link to the generation page externally — it requires admin auth and the download is one-shot.',
            'Don\'t generate over an unbounded date range. The browser will run out of memory before you find out.',
            'Don\'t rely on the bundle as your only backup. The Supabase storage buckets are still the source of truth.',
          ]}
        />
      </Section>

      <Section id="related" title="Related modules">
        <Related items={[
          { href: '/wiki/audit',     label: 'Audit Log' },
          { href: '/wiki/scorecard', label: 'EHS Scorecard' },
          { href: '/wiki/inspector', label: 'Inspector Access' },
        ]} />
      </Section>
    </WikiPage>
  )
}
