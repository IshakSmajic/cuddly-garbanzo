import { describe, expect, it } from 'vitest'
import { dayLabel, daysAgo, listTime, messageTime, sameDay } from './chatTime.ts'

// Local times, so the tests hold in any time zone.
const now = new Date(2026, 9, 16, 9, 30) // Fri 16 Oct 2026, 09:30
const at = (...args: [number, number, number, number?, number?]) => new Date(...args).toISOString()

describe('daysAgo', () => {
  it('counts calendar days, not 24-hour periods', () => {
    expect(daysAgo(new Date(2026, 9, 16, 0, 1), now)).toBe(0)
    expect(daysAgo(new Date(2026, 9, 15, 23, 59), now)).toBe(1)
  })
})

describe('dayLabel', () => {
  it('names today and yesterday', () => {
    expect(dayLabel(at(2026, 9, 16, 8), now)).toBe('Today')
    expect(dayLabel(at(2026, 9, 15, 22), now)).toBe('Yesterday')
  })

  it('uses the weekday within a week, then the date', () => {
    expect(dayLabel(at(2026, 9, 12), now)).not.toMatch(/\d/) // a weekday name
    expect(dayLabel(at(2026, 9, 3), now)).toMatch(/3/)
    expect(dayLabel(at(2025, 9, 3), now)).toMatch(/2025/)
  })
})

describe('listTime', () => {
  it('shows the time for today and the day otherwise', () => {
    expect(listTime(at(2026, 9, 16, 8, 5), now)).toBe(messageTime(at(2026, 9, 16, 8, 5)))
    expect(listTime(at(2026, 9, 15, 8, 5), now)).toBe('Yesterday')
  })
})

describe('sameDay', () => {
  it('compares calendar days', () => {
    expect(sameDay(at(2026, 9, 16, 0, 1), at(2026, 9, 16, 23, 59))).toBe(true)
    expect(sameDay(at(2026, 9, 15, 23, 59), at(2026, 9, 16, 0, 1))).toBe(false)
  })
})
