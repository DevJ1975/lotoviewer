import { describe, it, expect } from 'vitest'
import { timeOfDayGreeting } from '@/components/Greeting'

describe('timeOfDayGreeting', () => {
  function at(hour: number, minute = 0) {
    const d = new Date('2026-04-21T00:00:00')
    d.setHours(hour, minute, 0, 0)
    return d
  }

  it('says "Good morning" before noon', () => {
    expect(timeOfDayGreeting(at(0))).toBe('Good morning')
    expect(timeOfDayGreeting(at(6, 30))).toBe('Good morning')
    expect(timeOfDayGreeting(at(11, 59))).toBe('Good morning')
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
})
