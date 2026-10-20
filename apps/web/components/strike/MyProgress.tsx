'use client'

import { useCallback, useEffect, useState } from 'react'
import { Award, Lock, Trophy, Users } from 'lucide-react'
import type { StrikeBadge, TeamStanding } from '@soteria/core/strikeGamification'
import { strikeFetch } from '@/lib/strike/clientApi'

interface Progress {
  xp: number
  badges: StrikeBadge[]
  rank: { rank: number; of: number } | null
  teams: TeamStanding[]
  opted_in: boolean
  leaders: { name: string; xp: number; you: boolean }[] | null
  individual_board_enabled?: boolean
}

// XP and badges reward finishing training, never speed or score. Your rank
// is shown only to you; the individual board lists only people who chose to
// appear on it.
export function MyProgress({ tenantId }: { tenantId: string }) {
  const [progress, setProgress] = useState<Progress | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    strikeFetch<Progress>('/api/strike/progress', tenantId).then(setProgress).catch(() => setProgress(null))
  }, [tenantId])
  useEffect(() => { load() }, [load])

  if (!progress) return null

  async function toggleOptIn() {
    setSaving(true)
    try {
      await strikeFetch('/api/strike/progress', tenantId, { body: { opt_in: !progress?.opted_in } })
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="my-progress" className="placard-surface grid gap-4 p-4 md:grid-cols-3">
      <div>
        <h2 id="my-progress" className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">My progress</h2>
        <p className="placard-numeric mt-1 text-3xl font-bold text-slate-900 dark:text-slate-100">{progress.xp.toLocaleString()} <span className="text-base font-semibold text-slate-500">XP</span></p>
        {progress.rank && progress.xp > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
            <Lock className="h-3 w-3" aria-hidden /> #{progress.rank.rank} of {progress.rank.of} at your site (only you see this)
          </p>
        )}
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Badges">
          {progress.badges.length === 0 && <li className="text-xs text-slate-500">Pass your first module to earn a badge.</li>}
          {progress.badges.map(b => (
            <li key={b.id} title={b.description} className="inline-flex items-center gap-1 rounded-full bg-brand-yellow px-2.5 py-1 text-xs font-bold text-slate-950">
              <Award className="h-3.5 w-3.5" aria-hidden /> {b.label}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500"><Users className="h-3.5 w-3.5" aria-hidden /> Team board</h3>
        {progress.teams.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">Teams appear once a department has three or more people training.</p>
        ) : (
          <ol className="mt-2 space-y-1 text-sm">
            {progress.teams.slice(0, 5).map((t, i) => (
              <li key={t.team} className="flex justify-between gap-2">
                <span className="text-slate-800 dark:text-slate-100">{i + 1}. {t.team}</span>
                <span className="tabular-nums text-slate-500">{t.xpPerMember} XP/person</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div>
        <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-[0.14em] text-slate-500"><Trophy className="h-3.5 w-3.5" aria-hidden /> Leaderboard</h3>
        {progress.individual_board_enabled === false ? (
          <p className="mt-2 text-xs text-slate-500">Your site has the individual leaderboard turned off.</p>
        ) : progress.leaders ? (
          <ol className="mt-2 space-y-1 text-sm">
            {progress.leaders.map((l, i) => (
              <li key={`${l.name}-${i}`} className={`flex justify-between gap-2 ${l.you ? 'font-semibold text-brand-navy dark:text-blue-300' : 'text-slate-800 dark:text-slate-100'}`}>
                <span>{i + 1}. {l.name}{l.you ? ' (you)' : ''}</span>
                <span className="tabular-nums">{l.xp}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-xs text-slate-500">Off by default. Join to see others who also chose to.</p>
        )}
        {progress.individual_board_enabled !== false && (
          <button type="button" onClick={toggleOptIn} disabled={saving}
            className="mt-2 text-xs font-semibold text-brand-navy underline-offset-2 hover:underline disabled:opacity-50 dark:text-blue-300">
            {progress.opted_in ? 'Leave the leaderboard' : 'Join the leaderboard'}
          </button>
        )}
      </div>
    </section>
  )
}
