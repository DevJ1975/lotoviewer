import { BookOpen, CheckCircle2, XCircle, Sparkles } from 'lucide-react'
import { WIKI_MANIFEST } from './_lib/manifest'
import WikiSearch, { CategoryNav } from './_components/WikiSearch'

// /wiki — the umbrella index. Lists every documented module grouped by
// category, plus the "Wiki update protocol" + global Do's & Don'ts.
//
// Pages live at /wiki/<slug>. The slug-to-page mapping is in
// apps/web/app/wiki/_lib/manifest.ts. Adding a new module:
//   1. Append an entry to WIKI_MANIFEST.
//   2. Create apps/web/app/wiki/<slug>/page.tsx.
//   3. The card on this index appears automatically.

const CURRENT_VERSION = '1.0.0'
const LAST_UPDATED    = '2026-05-05'

export default function WikiIndexPage() {
  return (
    <main className="max-w-5xl mx-auto px-4 py-10 space-y-12 text-slate-800 dark:text-slate-100">
      <header className="space-y-4">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow text-xs font-semibold">
          <BookOpen className="h-3.5 w-3.5" /> User wiki
        </span>
        <div className="space-y-2">
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Soteria FIELD wiki
          </h1>
          <p className="text-base text-slate-600 dark:text-slate-300 max-w-2xl leading-7">
            Plain-English usage guides for every module, with FAQs and a
            Do&apos;s &amp; Don&apos;ts cheat sheet for each one. Search,
            jump by category, or scroll the whole catalog.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span className="font-mono">Index v{CURRENT_VERSION}</span>
          <span aria-hidden>·</span>
          <span>Updated {LAST_UPDATED}</span>
          <span aria-hidden>·</span>
          <span>{WIKI_MANIFEST.length} modules documented</span>
        </div>
      </header>

      <CategoryNav />

      <WikiSearch />

      <section id="dos-donts" className="space-y-4 scroll-mt-20">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-navy dark:text-brand-yellow" />
          <h2 className="text-2xl font-bold tracking-tight">Global Do&apos;s &amp; Don&apos;ts</h2>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
          Habits that apply across every module. Per-module rules live on the
          individual wiki pages.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-900/10 p-5">
            <h3 className="text-sm font-bold text-emerald-700 dark:text-emerald-400 mb-3 flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4" /> Do
            </h3>
            <ul className="text-sm space-y-2.5 text-emerald-900 dark:text-emerald-200">
              <Item>Confirm the active <strong>tenant pill</strong> in the header before doing data entry — it scopes every read and write.</Item>
              <Item>Capture photos and signatures <strong>in the field</strong>, not from memory back at the desk.</Item>
              <Item>Use the <strong>Support</strong> module to report bugs — it auto-captures the page URL and your session, which speeds up triage.</Item>
              <Item>Read this wiki page for a module before training a new colleague on it.</Item>
              <Item>Treat every <strong>signed PDF</strong> as the legal record — store the URL in your work-order system.</Item>
            </ul>
          </div>
          <div className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-900/10 p-5">
            <h3 className="text-sm font-bold text-rose-700 dark:text-rose-400 mb-3 flex items-center gap-1.5">
              <XCircle className="h-4 w-4" /> Don&apos;t
            </h3>
            <ul className="text-sm space-y-2.5 text-rose-900 dark:text-rose-200">
              <Item color="rose">Don&apos;t share your account — every action is logged against the signed-in user via <code className="kbd">/admin/audit</code>.</Item>
              <Item color="rose">Don&apos;t edit data while you see the <strong>offline banner</strong> unless the module explicitly supports queued writes (LOTO equipment + decommission).</Item>
              <Item color="rose">Don&apos;t back-date entries — the system stamps server time and that&apos;s the inspector-facing record.</Item>
              <Item color="rose">Don&apos;t paste tokenized public URLs (<code className="kbd">/review/…</code>, <code className="kbd">/permit-signon/…</code>, <code className="kbd">/inspector?sig=…</code>) into shared chat channels — they&apos;re bearer tokens.</Item>
              <Item color="rose">Don&apos;t delete data to &quot;clean up&quot; — use Decommission, Cancel, or Revoke so the audit trail is preserved.</Item>
            </ul>
          </div>
        </div>
      </section>

      <section id="protocol" className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-6 space-y-3 scroll-mt-20">
        <h2 className="text-lg font-bold tracking-tight">Wiki update protocol</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-7">
          When a module&apos;s behavior changes, the matching wiki page must be
          updated in the same PR. The <code className="kbd">npm run check:wiki</code> script
          runs in CI and as a pre-push hook; it diffs the branch against{' '}
          <code className="kbd">origin/main</code> and fails if any source path
          under a module (per <code className="kbd">apps/web/app/wiki/_lib/manifest.ts</code>)
          was touched without also touching its <code className="kbd">page.tsx</code>.
        </p>
        <ol className="list-decimal ml-6 text-sm space-y-1.5 text-slate-700 dark:text-slate-300">
          <li>Edit the relevant section on <code className="kbd">apps/web/app/wiki/&lt;slug&gt;/page.tsx</code>.</li>
          <li>Bump <code className="kbd">CURRENT_VERSION</code> and prepend a row to <code className="kbd">CHANGELOG</code>.</li>
          <li>Update <code className="kbd">LAST_UPDATED</code> to today&apos;s date.</li>
          <li>If the change is intentionally undocumented (refactor, test-only, dependency bump), set <code className="kbd">WIKI_SYNC_SKIP=1</code> in the commit body and explain why.</li>
        </ol>
      </section>
    </main>
  )
}

function Item({ children, color = 'emerald' }: { children: React.ReactNode; color?: 'emerald' | 'rose' }) {
  const dot = color === 'rose' ? 'bg-rose-500' : 'bg-emerald-500'
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1.5 h-1 w-1 rounded-full ${dot} shrink-0`} aria-hidden />
      <span className="leading-6">{children}</span>
    </li>
  )
}
