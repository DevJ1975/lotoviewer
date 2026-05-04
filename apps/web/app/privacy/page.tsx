import Link from 'next/link'

// Privacy policy — starter template for Soteria FIELD. Functional for
// small/mid B2B SaaS but should be reviewed by counsel before any
// enterprise customer signs an MSA. Update LAST_UPDATED whenever
// material changes ship.

const LAST_UPDATED = 'April 28, 2026'

export default function PrivacyPolicyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <header className="border-b border-slate-200 dark:border-slate-700 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Legal</p>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-1">Privacy Policy</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Last updated: {LAST_UPDATED}</p>
      </header>

      <Section title="1. Who we are">
        <p>
          Soteria FIELD (&ldquo;Soteria&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;) is a field-safety operations
          platform operated by Trainovate Technologies. We provide tools for managing Lockout/Tagout
          procedures, Permit-Required Confined Space entries, and Hot Work permits at industrial and
          manufacturing sites.
        </p>
        <p>This policy describes what personal information we collect when you use Soteria FIELD, how we use it, and the choices you have.</p>
      </Section>

      <Section title="2. What we collect">
        <p>We collect only what we need to operate the service:</p>
        <ul>
          <li><strong>Account information.</strong> Email address, full name, role (e.g. supervisor, admin), and the temporary password we issue at invitation. You change the temporary password on first login; we never see your chosen password.</li>
          <li><strong>Operational data you create.</strong> Permits, equipment records, atmospheric test readings, hazard descriptions, signatures, photos, and notes you enter into the app. This is the data your team needs to do its work.</li>
          <li><strong>Audit metadata.</strong> Every state change (signing a permit, marking work complete, canceling) is logged with the actor&rsquo;s ID, the timestamp, and the before/after row state. This is required for OSHA-style compliance traceability.</li>
          <li><strong>Device + session data.</strong> Browser type, OS, IP address, and timestamps for security and abuse prevention. Standard for any web service.</li>
          <li><strong>Push subscription data.</strong> If you opt into push notifications, your device&rsquo;s push endpoint and crypto keys.</li>
        </ul>
        <p>We do <strong>not</strong> collect: location data beyond IP-derived approximate geolocation, device contact lists, or analytics from sites outside Soteria FIELD.</p>
      </Section>

      <Section title="3. How we use it">
        <ul>
          <li>To run the service &mdash; permit lifecycle, audit logging, status boards, push alerts.</li>
          <li>To send invite emails and security notifications via our email provider.</li>
          <li>To investigate bugs, security incidents, and abuse.</li>
          <li>To improve the product based on aggregate, non-personal usage patterns (e.g. &ldquo;X% of supervisors use the status board&rdquo;).</li>
        </ul>
        <p>We do <strong>not</strong> sell or rent your data, and we do not use it for advertising of any kind.</p>
      </Section>

      <Section title="4. Subprocessors">
        <p>We use a small number of trusted infrastructure providers to deliver the service:</p>
        <ul>
          <li><strong>Supabase</strong> &mdash; database, authentication, file storage. Hosted in the United States.</li>
          <li><strong>Vercel</strong> &mdash; web application hosting and content delivery. Global edge network.</li>
          <li><strong>Resend</strong> &mdash; transactional email (invites, support replies). United States.</li>
          <li><strong>Anthropic</strong> &mdash; if you use AI hazard-suggestion features, the prompt and your work description are sent to Anthropic&rsquo;s API and discarded after the response. No model training on your data.</li>
        </ul>
        <p>Each subprocessor is contractually bound to handle your data in accordance with their published privacy policies and applicable law (CCPA, GDPR where relevant).</p>
      </Section>

      <Section title="5. How long we keep it">
        <ul>
          <li><strong>Active permit + equipment data.</strong> Retained for as long as your account is active, plus the regulatory retention period that applies to your industry (typically 1&ndash;5 years for OSHA-bound records).</li>
          <li><strong>Audit log.</strong> Retained for the lifetime of your account. Audit log rows are never hard-deleted, even when the underlying record is canceled, because that defeats the purpose of an audit trail.</li>
          <li><strong>Account data.</strong> Retained while the account exists. On account deletion, we remove personally-identifying fields within 30 days; audit log entries referencing the user are retained but anonymized.</li>
          <li><strong>Email logs.</strong> Resend retains delivery metadata per their policy; we don&rsquo;t store the email body content beyond what&rsquo;s in your inbox and ours.</li>
        </ul>
      </Section>

      <Section title="6. Security">
        <p>
          All data is transmitted over TLS. Database access is gated by Postgres row-level security
          policies that scope every read and write to the authenticated user. Service-role credentials
          are never exposed to the browser. Photos and PDFs are stored in Supabase Storage with the
          same RLS scoping.
        </p>
        <p>If we discover a security incident affecting your data, we will notify you in line with applicable breach notification law (typically within 72 hours of confirmation).</p>
      </Section>

      <Section title="7. Your rights">
        <p>Depending on where you live, you may have the right to:</p>
        <ul>
          <li>Access the personal data we hold about you.</li>
          <li>Correct inaccurate personal data.</li>
          <li>Request deletion (subject to regulatory retention obligations on audit records).</li>
          <li>Export your data in a portable format.</li>
          <li>Object to certain processing.</li>
        </ul>
        <p>To exercise any of these rights, email us at the address below. We respond within 30 days.</p>
      </Section>

      <Section title="8. Children">
        <p>Soteria FIELD is a workplace-safety tool for adult professionals. We do not knowingly collect data from anyone under 18.</p>
      </Section>

      <Section title="9. Changes">
        <p>
          We will update this policy from time to time. When we do, we&rsquo;ll change the &ldquo;Last
          updated&rdquo; date at the top of the page and, for material changes, notify account
          administrators by email at least 30 days before the change takes effect.
        </p>
      </Section>

      <Section title="10. Contact">
        <p>
          Questions about this policy or your data?{' '}
          <a href="mailto:jamil@trainovations.com" className="text-brand-navy dark:text-brand-yellow underline font-semibold">
            jamil@trainovations.com
          </a>
        </p>
      </Section>

      <footer className="pt-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <Link href="/terms" className="hover:underline">Terms of Service →</Link>
        <span>Soteria FIELD · Trainovate Technologies</span>
      </footer>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      <div className="text-sm leading-relaxed text-slate-700 dark:text-slate-300 space-y-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1 [&_a]:text-brand-navy [&_a]:dark:text-brand-yellow [&_a]:underline">
        {children}
      </div>
    </section>
  )
}
