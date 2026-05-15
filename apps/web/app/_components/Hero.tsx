'use client'

import { WeatherCard } from './WeatherCard'

// Greeting band at the top of the dashboard. Holds the per-time-of-day
// greeting, the live clock, and the user-local weather. Greeting / clock
// values are computed in the parent so a single 1Hz interval drives the
// whole page; weather is self-contained inside WeatherCard.

export function Hero({
  greeting, firstName, dateLabel, timeLabel, quote,
}: { greeting: string; firstName: string; dateLabel: string; timeLabel: string; quote: string }) {
  return (
    <section className="relative overflow-hidden rounded-md bg-[#0E1A2E] text-white steel-scanlines shadow-[0_18px_44px_-20px_rgba(2,8,23,0.55)] ring-1 ring-white/5 corner-brackets">
      {/* Hazard stripe rail on the left edge — reads as a guarded
          piece of equipment, not a marketing gradient. */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 hazard-stripe-thin" aria-hidden="true" />
      {/* Inverted hazard cap along the bottom for symmetry with the
          shell's header stripe. */}
      <div className="absolute right-0 bottom-0 h-[3px] left-1.5 bg-gradient-to-r from-transparent via-brand-yellow/70 to-brand-yellow" aria-hidden="true" />

      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end p-6 pl-7 sm:p-8 sm:pl-10">
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
        <WeatherCard />
      </div>
    </section>
  )
}
