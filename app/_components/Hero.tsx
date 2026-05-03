'use client'

import { WeatherCard } from './WeatherCard'

// Greeting band at the top of the dashboard. Holds the per-time-of-day
// greeting, the live clock, and the user-local weather. Greeting / clock
// values are computed in the parent so a single 1Hz interval drives the
// whole page; weather is self-contained inside WeatherCard.

export function Hero({
  greeting, firstName, dateLabel, timeLabel,
}: { greeting: string; firstName: string; dateLabel: string; timeLabel: string }) {
  return (
    <section className="bg-gradient-to-br from-brand-navy to-[#1a3470] text-white rounded-2xl p-6 sm:p-8 shadow-md">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end">
        <div>
          <p className="text-2xl sm:text-3xl font-bold tracking-tight">
            {greeting}, <span className="text-brand-yellow">{firstName}</span>
          </p>
          <p className="text-sm sm:text-base text-white/80 mt-2">{dateLabel}</p>
          <p className="text-3xl sm:text-4xl font-mono font-bold mt-1 tabular-nums">{timeLabel}</p>
        </div>
        <WeatherCard />
      </div>
    </section>
  )
}
