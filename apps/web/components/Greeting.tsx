'use client'

import { useAuth } from '@/components/AuthProvider'

export function timeOfDayGreeting(date = new Date()): string {
  const holidayGreeting = usHolidayGreeting(date)
  if (holidayGreeting) return holidayGreeting

  const h = date.getHours()
  if (h < 5) return 'Burning the midnight oil'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function usHolidayGreeting(date = new Date()): string | null {
  const month = date.getMonth()
  const day = date.getDate()

  if (month === 0 && day === 1) return 'Happy New Year'
  if (month === 0 && isNthWeekdayOfMonth(date, 1, 3)) return 'Honoring Martin Luther King Jr. Day'
  if (month === 1 && isNthWeekdayOfMonth(date, 1, 3)) return "Happy Presidents' Day"
  if (month === 4 && isLastWeekdayOfMonth(date, 1)) return 'Honoring Memorial Day'
  if (month === 5 && day === 19) return 'Happy Juneteenth'
  if (month === 6 && day === 4) return 'Happy 4th of July'
  if (month === 8 && isNthWeekdayOfMonth(date, 1, 1)) return 'Happy Labor Day'
  if (month === 9 && isNthWeekdayOfMonth(date, 1, 2)) return 'Happy Columbus Day'
  if (month === 10 && day === 11) return 'Happy Veterans Day'
  if (month === 10 && isNthWeekdayOfMonth(date, 4, 4)) return 'Happy Thanksgiving'
  if (month === 11 && day === 25) return 'Merry Christmas'

  return null
}

export interface DailyQuote {
  text: string
}

const DAILY_QUOTES: DailyQuote[] = [
  { text: 'Safety grows when people trust each other enough to speak early.' },
  { text: 'Strong leaders make the careful choice the easy choice.' },
  { text: 'A good shift starts with attention and ends with everyone going home well.' },
  { text: 'The best teams catch small signals before they become big problems.' },
  { text: 'Progress is built one prepared conversation and one checked control at a time.' },
  { text: 'A positive culture is visible in how quickly people help each other do it right.' },
  { text: 'Leadership is the habit of making room for the safest next step.' },
  { text: 'Every clear handoff is a quiet act of care for the next person.' },
  { text: 'Confidence on the floor comes from controls that are understood, practiced, and respected.' },
  { text: 'The safest plan is the one the whole team can explain.' },
  { text: 'Prepared people turn complex work into calm, repeatable work.' },
  { text: 'A near miss shared today can prevent an injury tomorrow.' },
  { text: 'Good questions are safety tools; use them before the job begins.' },
  { text: 'The standard you walk past becomes the standard people learn.' },
  { text: 'Respect the checklist, then improve the system behind it.' },
  { text: 'A steady team does not rush past uncertainty; it clears it.' },
  { text: 'Safe work is not slow work; it is work with fewer surprises.' },
  { text: 'The strongest safety cultures reward attention, honesty, and follow-through.' },
  { text: 'If the condition changed, the plan should change with it.' },
  { text: 'Great crews protect the work and the people doing it.' },
  { text: 'The right pause at the right time is a mark of professionalism.' },
  { text: 'Clear expectations turn good intentions into reliable performance.' },
  { text: 'Positive momentum starts when one person chooses to model the standard.' },
  { text: 'A clean handoff is leadership in motion.' },
  { text: 'When people feel heard, hazards get found sooner.' },
  { text: 'Small checks done consistently build large margins of safety.' },
  { text: 'The most useful safety data is the data a team acts on.' },
  { text: 'Good work protects quality, schedule, and people at the same time.' },
  { text: 'Ownership means caring enough to fix what could hurt someone later.' },
  { text: 'The best safety meeting ends with one clear action people can remember.' },
  { text: 'A calm start gives the whole shift a better chance to finish well.' },
]

export function dailyQuote(date = new Date()): DailyQuote {
  return DAILY_QUOTES[dayOfYear(date) % DAILY_QUOTES.length]!
}

function firstName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  return fullName.trim().split(/\s+/)[0] ?? ''
}

function isNthWeekdayOfMonth(date: Date, weekday: number, nth: number): boolean {
  return date.getDay() === weekday && Math.floor((date.getDate() - 1) / 7) + 1 === nth
}

function isLastWeekdayOfMonth(date: Date, weekday: number): boolean {
  if (date.getDay() !== weekday) return false
  const nextWeek = new Date(date)
  nextWeek.setDate(date.getDate() + 7)
  return nextWeek.getMonth() !== date.getMonth()
}

function dayOfYear(date: Date): number {
  return Math.floor(
    (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(date.getFullYear(), 0, 0))
    / 86_400_000,
  )
}

export default function Greeting({ className = '' }: { className?: string }) {
  const { profile, email } = useAuth()
  const name = firstName(profile?.full_name) || (email ? email.split('@')[0] : '')
  if (!name) return null
  return (
    <span className={`text-sm font-medium ${className}`}>
      {timeOfDayGreeting()}, <span className="font-semibold">{name}</span>
    </span>
  )
}
