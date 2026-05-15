import { describe, it, expect } from 'vitest'
import { dailyQuote, timeOfDayGreeting, usHolidayGreeting } from '@/components/Greeting'

describe('timeOfDayGreeting', () => {
  function at(hour: number, minute = 0) {
    const d = new Date('2026-04-21T00:00:00')
    d.setHours(hour, minute, 0, 0)
    return d
  }

  it('says "Good morning" before noon', () => {
    expect(timeOfDayGreeting(at(6, 30))).toBe('Good morning')
    expect(timeOfDayGreeting(at(11, 59))).toBe('Good morning')
  })

  it('recognizes late-night users after midnight', () => {
    expect(timeOfDayGreeting(at(0))).toBe('Burning the midnight oil')
    expect(timeOfDayGreeting(at(4, 59))).toBe('Burning the midnight oil')
    expect(timeOfDayGreeting(at(5))).toBe('Good morning')
  })

  it('says "Good afternoon" from noon to 5pm', () => {
    expect(timeOfDayGreeting(at(12))).toBe('Good afternoon')
    expect(timeOfDayGreeting(at(15))).toBe('Good afternoon')
    expect(timeOfDayGreeting(at(16, 59))).toBe('Good afternoon')
  })

  it('says "Good evening" from 5pm onward', () => {
    expect(timeOfDayGreeting(at(17))).toBe('Good evening')
    expect(timeOfDayGreeting(at(20))).toBe('Good evening')
    expect(timeOfDayGreeting(at(23, 59))).toBe('Good evening')
  })

  it('uses the boundary at exactly 12:00 → afternoon', () => {
    expect(timeOfDayGreeting(at(12, 0))).toBe('Good afternoon')
  })

  it('uses the boundary at exactly 17:00 → evening', () => {
    expect(timeOfDayGreeting(at(17, 0))).toBe('Good evening')
  })

  it('uses holiday greetings before time-of-day greetings', () => {
    expect(timeOfDayGreeting(new Date('2026-01-01T09:00:00'))).toBe('Happy New Year')
    expect(timeOfDayGreeting(new Date('2026-07-04T09:00:00'))).toBe('Happy 4th of July')
    expect(timeOfDayGreeting(new Date('2026-11-11T09:00:00'))).toBe('Happy Veterans Day')
    expect(timeOfDayGreeting(new Date('2026-11-26T09:00:00'))).toBe('Happy Thanksgiving')
    expect(timeOfDayGreeting(new Date('2026-12-25T09:00:00'))).toBe('Merry Christmas')
  })
})

describe('usHolidayGreeting', () => {
  it('covers major US federal holidays with safe greetings', () => {
    expect(usHolidayGreeting(new Date('2026-01-19T09:00:00'))).toBe('Honoring Martin Luther King Jr. Day')
    expect(usHolidayGreeting(new Date('2026-02-16T09:00:00'))).toBe("Happy Presidents' Day")
    expect(usHolidayGreeting(new Date('2026-05-25T09:00:00'))).toBe('Honoring Memorial Day')
    expect(usHolidayGreeting(new Date('2026-06-19T09:00:00'))).toBe('Happy Juneteenth')
    expect(usHolidayGreeting(new Date('2026-09-07T09:00:00'))).toBe('Happy Labor Day')
    expect(usHolidayGreeting(new Date('2026-10-12T09:00:00'))).toBe('Happy Columbus Day')
  })

  it('returns null on non-holidays', () => {
    expect(usHolidayGreeting(new Date('2026-04-21T09:00:00'))).toBeNull()
  })
})

describe('dailyQuote', () => {
  it('returns deterministic safety-positive copy for the same date', () => {
    const date = new Date('2026-04-21T09:00:00')
    expect(dailyQuote(date)).toEqual(dailyQuote(date))
  })

  it('does not include spiritual, religious, political, or offensive terms', () => {
    const blocked = /\b(god|prayer|blessed|church|religion|democrat|republican|election|campaign|hate|stupid)\b/i
    for (let day = 1; day <= 31; day += 1) {
      expect(dailyQuote(new Date(2026, 0, day)).text).not.toMatch(blocked)
    }
  })
})
