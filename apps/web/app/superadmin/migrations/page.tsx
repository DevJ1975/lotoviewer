import Link from 'next/link'
import { ArrowLeft, Database } from 'lucide-react'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// Server component. Reads apps/web/migrations/*.sql at request time
// (the migrations directory is deployed alongside the app). Renders
// a static list with GitHub links so a superadmin can verify which
// migrations exist in the repo and which are in their database.
//
// We do NOT query the DB for what's applied — Supabase doesn't track
// raw SQL pastes through schema_migrations, so any "applied" column
// would lie. The dashboard's purpose is "what's in the repo?", paired
// with the SQL editor to verify what's in the DB.

export const dynamic = 'force-dynamic'

const REPO_BASE = process.env.NEXT_PUBLIC_GITHUB_REPO ?? 'devj1975/lotoviewer'

interface MigrationFile {
  name:    string
  number:  string  // '047', '048', etc.
  bytes:   number
}

async function readMigrations(): Promise<MigrationFile[]> {
  // Try a couple of locations because the runtime cwd differs
  // between dev (apps/web) and Vercel (the deployed root).
  const candidates = [
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), 'apps/web/migrations'),
  ]
  for (const dir of candidates) {
    try {
      const names = await fs.readdir(dir)
      const sqlFiles = names.filter(n => n.endsWith('.sql')).sort()
      const out: MigrationFile[] = []
      for (const name of sqlFiles) {
        const stat = await fs.stat(path.join(dir, name))
        const m = name.match(/^(\d{3})_/)
        out.push({
          name,
          number: m ? m[1] : '',
          bytes:  stat.size,
        })
      }
      return out
    } catch {
      // Try the next candidate.
    }
  }
  return []
}

export default async function MigrationsPage() {
  const files = await readMigrations()

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <header className="flex items-start gap-3">
        <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Database className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
            Migrations
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
            Migration files in the repo. Run this query in Supabase to compare:
          </p>
          <pre className="mt-2 text-[11px] font-mono bg-slate-100 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-2 overflow-x-auto">
{`select * from supabase_migrations.schema_migrations
 order by version desc limit 20;`}
          </pre>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-snug">
            Note: migrations applied via the Supabase SQL editor (paste &amp; run) don&apos;t
            populate <code className="font-mono">schema_migrations</code>. The list below
            shows what&apos;s in the repo; matching it against your DB&apos;s schema is a
            human exercise.
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden">
        <div className="px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
          {files.length} migration{files.length === 1 ? '' : 's'} in repo
        </div>
        {files.length === 0 ? (
          <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
            Couldn&apos;t locate migrations directory. The deploy may have stripped non-bundled files;
            check Vercel&apos;s output trace.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {files.map(f => (
              <li key={f.name} className="px-4 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <code className="text-sm font-mono font-medium text-slate-900 dark:text-slate-100 truncate block" title={f.name}>
                    {f.name}
                  </code>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                    {f.bytes >= 1024 ? `${(f.bytes / 1024).toFixed(1)} KB` : `${f.bytes} B`}
                  </span>
                </div>
                <a
                  href={`https://github.com/${REPO_BASE}/blob/main/apps/web/migrations/${f.name}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-semibold text-brand-navy dark:text-brand-yellow hover:underline shrink-0"
                >
                  GitHub →
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
