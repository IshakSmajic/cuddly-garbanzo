import { describe, expect, it } from 'vitest'
import { friendErrorMessage, normalizeSearch, searchQueryError } from './friendRules.ts'

describe('searchQueryError', () => {
  it('says nothing while the box is empty', () => {
    expect(searchQueryError('')).toBeNull()
  })

  it('needs at least 3 characters', () => {
    expect(searchQueryError('an')).toBe('Type at least 3 characters.')
    expect(searchQueryError('ana')).toBeNull()
  })

  it('allows up to 20 characters', () => {
    expect(searchQueryError('a'.repeat(20))).toBeNull()
    expect(searchQueryError('a'.repeat(21))).toBe('Usernames are at most 20 characters.')
  })

  it.each(['an%', 'a b', 'ana-1', 'ånа'])('rejects characters a username cannot contain: "%s"', (query) => {
    expect(searchQueryError(query)).toBe('Usernames contain only letters, numbers and underscores.')
  })

  it('allows underscores (the server escapes them)', () => {
    expect(searchQueryError('ana_')).toBeNull()
  })
})

describe('normalizeSearch', () => {
  it('trims and lowercases, as the server does', () => {
    expect(normalizeSearch('  ANA_One ')).toBe('ana_one')
  })
})

describe('friendErrorMessage', () => {
  it.each([
    ['TB001', "You can't send a request to this person."],
    ['TB002', "You're already friends."],
    ['TB003', 'This request was already answered or cancelled.'],
    ['TB005', 'They declined your last request. You can ask again after 24 hours.'],
  ])('explains %s', (code, message) => {
    expect(friendErrorMessage({ code, message: 'server text' })).toBe(message)
  })

  it("passes on the server's rate-limit message", () => {
    expect(friendErrorMessage({ code: 'TB004', message: 'Too many requests. Try again in an hour.' })).toBe(
      'Too many requests. Try again in an hour.',
    )
  })

  it('falls back to a generic message', () => {
    expect(friendErrorMessage({ code: '42501', message: 'Request not found' })).toBe(
      'Something went wrong. Please try again.',
    )
    expect(friendErrorMessage(null)).toBe('Something went wrong. Please try again.')
  })
})
