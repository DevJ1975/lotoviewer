'use client'

import { useMemo } from 'react'
import { dailyQuote, timeOfDayGreeting } from '@/components/Greeting'
import { useNow } from '@/hooks/useNow'

// Live greeting + date + time + daily quote for the dashboard hero. Owns its
// own 1Hz tick via useNow so only this leaf re-renders each second — the rest
// of the home tree (KPI panels, module grid, command center) stays still.
const CLOCK_TICK_MS = 1000

export function Clock({ firstName }: { firstName: string }) {
  const now = useNow(CLOCK_TICK_MS)

  const greeting = useMemo(() => timeOfDayGreeting(now), [now])
  const quoteDateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const quote = useMemo(() => {
    const [year, month, day] = quoteDateKey.split('-').map(Number)
    return dailyQuote(new Date(year!, month!, day!)).text
  }, [quoteDateKey])
  const dateLabel = useMemo(() =>
    now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  [now])
  const timeLabel = useMemo(() =>
    now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
  [now])

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="placard-label text-brand-yellow">Control Center</span>
        <span aria-hidden="true" className="h-px flex-1 max-w-[6rem] bg-gradient-to-r from-brand-yellow/70 to-transparent" />
        <span className="placard-label text-white/45">SYS · LIVE</span>
      </div>
      <p className="stencil-title text-3xl sm:text-4xl text-white">
        {greeting},{' '}
        <span className="text-brand-yellow">{firstName}</span>
      </p>
      <p className="placard-label text-white/65 mt-3">{dateLabel}</p>
      <p className="placard-numeric mt-1 text-4xl sm:text-5xl font-bold text-white">
        {timeLabel}
      </p>
      <div className="mt-5 max-w-2xl border-l-2 border-brand-yellow/80 pl-3">
        <p className="placard-label text-brand-yellow/90">
          Quote of the day
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-white/85">
          {quote}
        </p>
      </div>
    </div>
  )
}
