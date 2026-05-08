'use client'

import { Trophy, Medal, Award } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import type { BBSLeaderboardRow } from '@soteria/core/bbsMetrics'

interface Props {
  rows:        BBSLeaderboardRow[]
  loading?:    boolean
  emptyHint?:  string
}

const RANK_ICON = [
  <Trophy key="t" className="w-4 h-4 text-amber-500" />,
  <Medal  key="m" className="w-4 h-4 text-slate-400" />,
  <Award  key="a" className="w-4 h-4 text-amber-700" />,
]

export function Leaderboard({ rows, loading, emptyHint }: Props) {
  if (loading) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
        Loading leaderboard…
      </div>
    )
  }
  if (rows.length === 0) {
    return (
      <div className="text-sm text-slate-500 dark:text-slate-400 py-6 text-center">
        {emptyHint ?? 'No submissions yet — be the first.'}
      </div>
    )
  }
  return (
    <ol className="divide-y divide-slate-200 dark:divide-slate-800">
      {rows.map((row, idx) => (
        <li key={row.user_id} className="flex items-center gap-3 py-2.5">
          <div className="w-6 text-center text-sm font-semibold text-slate-500">
            {idx < 3 ? RANK_ICON[idx] : <span>{idx + 1}</span>}
          </div>
          <Avatar src={row.avatar_url} name={row.full_name} size="md" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
              {row.full_name ?? 'Unknown'}
            </div>
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {row.observation_count} observation{row.observation_count === 1 ? '' : 's'}
              {row.unsafe_act_count + row.unsafe_condition_count > 0 && (
                <> · {row.unsafe_act_count + row.unsafe_condition_count} unsafe</>
              )}
              {row.safe_behavior_count > 0 && <> · {row.safe_behavior_count} safe</>}
            </div>
          </div>
          <div className={cn(
            'shrink-0 px-2.5 py-1 rounded font-semibold text-sm',
            idx === 0 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
          )}>
            {row.points_total} pts
          </div>
        </li>
      ))}
    </ol>
  )
}
