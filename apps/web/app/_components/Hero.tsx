'use client'

import { Clock } from './Clock'
import { WeatherCard } from './WeatherCard'

// Greeting band at the top of the dashboard. The live greeting/clock/quote
// live in the <Clock/> leaf so the 1Hz tick re-renders only that leaf, not
// the whole home tree; weather is self-contained inside WeatherCard. Hero
// itself is static — it re-renders only when the signed-in user changes.

export function Hero({ firstName }: { firstName: string }) {
  return (
    <section className="relative overflow-hidden rounded-md bg-[#0E1A2E] text-white steel-scanlines shadow-[0_18px_44px_-20px_rgba(2,8,23,0.55)] ring-1 ring-white/5 corner-brackets">
      {/* Hazard stripe rail on the left edge — reads as a guarded
          piece of equipment, not a marketing gradient. */}
      <div className="absolute left-0 top-0 bottom-0 w-1.5 hazard-stripe-thin" aria-hidden="true" />
      {/* Inverted hazard cap along the bottom for symmetry with the
          shell's header stripe. */}
      <div className="absolute right-0 bottom-0 h-[3px] left-1.5 bg-gradient-to-r from-transparent via-brand-yellow/70 to-brand-yellow" aria-hidden="true" />

      <div className="relative grid grid-cols-1 md:grid-cols-[1fr_auto] gap-6 items-end p-6 pl-7 sm:p-8 sm:pl-10">
        <Clock firstName={firstName} />
        <WeatherCard />
      </div>
    </section>
  )
}
