import { describe, expect, it } from 'vitest'
import {
  canSend,
  catchUp,
  compareMessages,
  MESSAGE_MAX,
  messageError,
  messageLength,
  mergeMessages,
  prepareMessage,
  timeKey,
  type Message,
} from './messageRules.ts'

const message = (id: number, created_at: string): Message => ({
  id,
  conversation_id: 'c',
  sender_id: 's',
  client_id: `client-${id}`,
  content: `m${id}`,
  created_at,
})

describe('prepareMessage and canSend', () => {
  it('trims the ends but keeps line breaks inside', () => {
    expect(prepareMessage('  hi\nthere \n')).toBe('hi\nthere')
  })

  it('cannot send nothing or only spaces', () => {
    expect(canSend('')).toBe(false)
    expect(canSend(' \n\t ')).toBe(false)
    expect(canSend(' a ')).toBe(true)
  })

  it('counts characters, not UTF-16 units, as the database does', () => {
    expect(messageLength('😀'.repeat(MESSAGE_MAX))).toBe(MESSAGE_MAX)
    expect(canSend('😀'.repeat(MESSAGE_MAX))).toBe(true)
  })

  it('refuses more than 4,000 characters', () => {
    expect(messageError('x'.repeat(MESSAGE_MAX + 1))).toBe('Messages are at most 4,000 characters.')
    expect(canSend('x'.repeat(MESSAGE_MAX + 1))).toBe(false)
    expect(messageError(` ${'x'.repeat(MESSAGE_MAX)} `)).toBeNull()
  })
})

describe('timeKey', () => {
  it('keeps microseconds that Date would drop', () => {
    expect(timeKey('2026-10-16T07:01:02.123457+00:00') - timeKey('2026-10-16T07:01:02.123456+00:00')).toBe(1)
  })

  it('handles trimmed fractions and no fraction', () => {
    expect(timeKey('2026-10-16T07:01:02.1+00:00')).toBe(timeKey('2026-10-16T07:01:02.100000+00:00'))
    expect(timeKey('2026-10-16T07:01:02+00:00') % 1_000_000).toBe(0)
  })

  it('respects the time zone', () => {
    expect(timeKey('2026-10-16T09:01:02.5+02:00')).toBe(timeKey('2026-10-16T07:01:02.5Z'))
  })
})

describe('compareMessages and mergeMessages', () => {
  it('orders by time, then id when the time is equal', () => {
    const a = message(2, '2026-10-16T07:00:00.000001+00:00')
    const b = message(1, '2026-10-16T07:00:00.000002+00:00')
    const c = message(3, '2026-10-16T07:00:00.000002+00:00')
    expect([c, b, a].sort(compareMessages).map((m) => m.id)).toEqual([2, 1, 3])
  })

  it('drops duplicates by id and keeps the order', () => {
    const one = message(1, '2026-10-16T07:00:00+00:00')
    const two = message(2, '2026-10-16T07:00:01+00:00')
    const three = message(3, '2026-10-16T07:00:02+00:00')
    expect(mergeMessages([one, three], [two, three]).map((m) => m.id)).toEqual([1, 2, 3])
  })
})

describe('catchUp', () => {
  const at = (second: number) => `2026-10-16T07:00:${String(second).padStart(2, '0')}+00:00`
  const page = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => message(from + i, at(from + i)))

  it('merges an overlapping page without duplicates', () => {
    const result = catchUp(page(1, 5), page(3, 7), 5)
    expect(result.gap).toBe(false)
    expect(result.messages.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('finds a gap when a full page is all newer than what we have', () => {
    const result = catchUp(page(1, 5), page(11, 15), 5)
    expect(result.gap).toBe(true)
    expect(result.messages.map((m) => m.id)).toEqual([11, 12, 13, 14, 15])
  })

  it('a short page is everything there is, so there is no gap', () => {
    expect(catchUp(page(1, 5), page(8, 9), 5).gap).toBe(false)
  })

  it('an empty chat simply takes the page', () => {
    expect(catchUp([], page(1, 3), 5)).toEqual({ messages: page(1, 3), gap: false })
  })
})
