import { describe, expect, it } from 'vitest'
import { displayNameError, newPasswordError, normalizeUsername, usernameError } from './validation.ts'

describe('normalizeUsername', () => {
  it('lowercases and trims', () => {
    expect(normalizeUsername('  Ana_1 ')).toBe('ana_1')
  })
})

describe('usernameError', () => {
  it.each(['ana', 'ana_1', 'a1b2c3', 'x'.repeat(20)])('accepts %s', (name) => {
    expect(usernameError(name)).toBeNull()
  })

  it.each([
    ['an', 'At least 3 characters.'],
    ['x'.repeat(21), 'At most 20 characters.'],
    ['ana-1', 'Use only letters, numbers and underscores.'],
    ['ana 1', 'Use only letters, numbers and underscores.'],
    ['Ana', 'Use only letters, numbers and underscores.'],
    ['ána', 'Use only letters, numbers and underscores.'],
  ])('rejects %s', (name, message) => {
    expect(usernameError(name)).toBe(message)
  })
})

describe('displayNameError', () => {
  it('rejects blank names', () => {
    expect(displayNameError('   ')).toBe('Enter a display name.')
  })

  it('counts emoji as one character, like PostgreSQL', () => {
    expect(displayNameError('😀'.repeat(50))).toBeNull()
    expect(displayNameError('😀'.repeat(51))).toBe('At most 50 characters.')
  })
})

describe('newPasswordError', () => {
  it('accepts a long enough password typed twice', () => {
    expect(newPasswordError('correct-horse', 'correct-horse')).toBeNull()
    expect(newPasswordError('12345678', '12345678')).toBeNull()
  })

  it('rejects a short password before comparing', () => {
    expect(newPasswordError('1234567', '7654321')).toBe('Use at least 8 characters for your password.')
  })

  it('rejects a mismatched confirmation', () => {
    expect(newPasswordError('correct-horse', 'correct-hors')).toBe("The passwords don't match.")
  })
})
