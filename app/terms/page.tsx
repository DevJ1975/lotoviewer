import Link from 'next/link'

// Terms of Service — starter template for Soteria FIELD. Functional for
// small/mid B2B SaaS but should be reviewed by counsel before any
// enterprise customer signs an MSA. Update LAST_UPDATED whenever
// material changes ship.

const LAST_UPDATED = 'April 28, 2026'

export default function TermsOfServicePage() {
  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-8">
      <header className="border-b border-slate-200 dark:border-slate-700 pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">Legal</p>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-1">Terms of Service</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Last updated: {LAST_UPDATED}</p>
      </header>

      <Section title="1. The agreement">
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) govern your use of Soteria FIELD
          (&ldquo;Service&rdquo;), a field-safety operations platform provided by Trainovate
          Technologies (&ldquo;Soteria&rdquo;, &ldquo;we&rdquo;, &ldquo;our&rdquo;). By creating an
          account or using the Service, you agree to these Terms.
        </p>
        <p>
          If you&rsquo;re using Soteria on behalf of an organization, you confirm that you have
          authority to bind that organization to these Terms.
        </p>
      </Section>

      <Section title="2. What the Service is — and isn't">
        <p>
          Soteria FIELD is a software tool that helps your team manage safety permits and procedures.
          It surfaces relevant regulatory citations (OSHA 29 CFR 1910.146, 1910.252, NFPA 51B,
          Cal/OSHA Title 8 §6777, and others), enforces lifecycle gates, and produces an audit trail.
        </p>
        <p>
          <strong>Soteria is a tool. It is not a substitute for a competent safety program, qualified
          personnel, professional judgement, or compliance review by a licensed safety professional.</strong>
          You retain full responsibility for your safety program, your training, and your decisions.
          We do not certify that any specific permit, procedure, or workflow you create with the
          Service is compliant with any law or regulation.
        </p>
      </Section>

      <Section title="3. Your account">
        <ul>
          <li>You&rsquo;re responsible for keeping your password secure and for everything that happens under your account.</li>
          <li>One person, one account. Don&rsquo;t share login credentials.</li>
          <li>Notify us immediately if you suspect your account has been compromised.</li>
          <li>Account creation is by invitation from an existing administrator. There is no public sign-up.</li>
        </ul>
      </Section>

      <Section title="4. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service to violate any law or regulation.</li>
          <li>Reverse engineer, decompile, or attempt to extract source code from the Service.</li>
          <li>Probe, scan, or test the security of the Service except as part of a coordinated disclosure agreement with us.</li>
          <li>Interfere with the operation of the Service or with other users.</li>
          <li>Upload content that you don&rsquo;t have the right to upload, or that is unlawful, infringing, or harmful.</li>
          <li>Resell access to the Service without our written agreement.</li>
        </ul>
      </Section>

      <Section title="5. Your data">
        <p>
          You own the operational data you put into Soteria FIELD &mdash; permits, equipment records,
          photos, signatures, audit log entries. We hold it on your behalf to make the Service work.
          You can export it at any time; we&rsquo;ll help if the export tooling doesn&rsquo;t cover
          something you need.
        </p>
        <p>
          You grant us a limited, non-exclusive license to process your data solely to operate, secure,
          and improve the Service. Our handling of personal information is governed by the{' '}
          <Link href="/privacy" className="text-brand-navy dark:text-brand-yellow underline font-semibold">Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="6. Subscription, billing, and cancellation">
        <p>
          Pricing and billing terms are set in the order form or invoice we agree on with your
          organization. Either party may terminate with 30 days&rsquo; written notice. On termination,
          we&rsquo;ll provide a final data export within 30 days; after that, we may delete your
          operational data, subject to the audit-log retention described in the Privacy Policy.
        </p>
      </Section>

      <Section title="7. Service availability">
        <p>
          We aim for high availability and depend on third-party infrastructure (Supabase, Vercel,
          Resend) to deliver the Service. We don&rsquo;t guarantee uninterrupted availability.
          Maintenance, infrastructure issues, and force majeure events may cause downtime.
        </p>
        <p>
          If a sustained outage materially impacts your use of the Service, contact us &mdash; we&rsquo;ll
          discuss remedy on a case-by-case basis.
        </p>
      </Section>

      <Section title="8. Warranty disclaimer">
        <p>
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;. WE DISCLAIM ALL
          WARRANTIES, EXPRESS OR IMPLIED, INCLUDING IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR
          A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE SERVICE WILL BE
          UNINTERRUPTED, ERROR-FREE, OR THAT IT WILL ENSURE YOUR COMPLIANCE WITH ANY LAW OR
          REGULATION.
        </p>
      </Section>

      <Section title="9. Limitation of liability">
        <p>
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, OUR TOTAL CUMULATIVE LIABILITY FOR ANY CLAIM ARISING
          OUT OF OR RELATING TO THE SERVICE IS LIMITED TO THE AMOUNTS YOU PAID US FOR THE SERVICE IN
          THE 12 MONTHS PRECEDING THE EVENT GIVING RISE TO THE CLAIM. WE WILL NOT BE LIABLE FOR
          INDIRECT, INCIDENTAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFITS, LOST
          REVENUE, OR LOSS OF DATA.
        </p>
        <p>
          Some jurisdictions don&rsquo;t allow the exclusion of certain warranties or limits on
          liability, so some of these may not apply to you.
        </p>
      </Section>

      <Section title="10. Indemnification">
        <p>
          You agree to indemnify and hold harmless Soteria, Trainovate Technologies, and its officers,
          employees, and agents from any claim arising out of (a) your use of the Service in violation
          of these Terms, (b) data you upload or actions you take through the Service, or (c) your
          violation of any law or third-party right.
        </p>
      </Section>

      <Section title="11. Changes to these Terms">
        <p>
          We may update these Terms from time to time. For material changes, we&rsquo;ll notify
          account administrators by email at least 30 days before the change takes effect. Continued
          use of the Service after a change constitutes acceptance of the updated Terms.
        </p>
      </Section>

      <Section title="12. Governing law">
        <p>
          These Terms are governed by the laws of the State of California, without regard to conflict
          of law principles. Any dispute that can&rsquo;t be resolved informally will be resolved by
          arbitration in San Diego County, California, except that either party may seek injunctive
          relief in court for intellectual property or confidentiality matters.
        </p>
      </Section>

      <Section title="13. Contact">
        <p>
          Questions, notices, or anything else?{' '}
          <a href="mailto:jamil@trainovations.com" className="text-brand-navy dark:text-brand-yellow underline font-semibold">
            jamil@trainovations.com
          </a>
        </p>
      </Section>

      <footer className="pt-6 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
        <Link href="/privacy" className="hover:underline">← Privacy Policy</Link>
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
