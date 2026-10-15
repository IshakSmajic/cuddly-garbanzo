import { describe, expect, it } from 'vitest'
import { AVATAR_INPUT_MAX_BYTES, avatarFileError, centreSquare, initials } from './avatar.ts'

describe('avatarFileError', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (type) => {
    expect(avatarFileError({ type, size: 100_000 })).toBeNull()
  })

  it.each(['image/gif', 'image/svg+xml', 'application/pdf', ''])('rejects type "%s"', (type) => {
    expect(avatarFileError({ type, size: 100_000 })).toBe('Choose a JPEG, PNG or WebP image.')
  })

  it('accepts a large phone photo, rejects anything bigger than the limit', () => {
    expect(avatarFileError({ type: 'image/jpeg', size: AVATAR_INPUT_MAX_BYTES })).toBeNull()
    expect(avatarFileError({ type: 'image/jpeg', size: AVATAR_INPUT_MAX_BYTES + 1 })).toBe(
      'That image is too large (15 MB at most).',
    )
  })
})

describe('initials', () => {
  it.each([
    ['Ana Test', 'AT'],
    ['ana', 'A'],
    ['ana_test', 'AT'],
    ['  Ana   Maria  Test ', 'AM'],
    ['😀 Smile', '😀S'],
    ['', '?'],
    [null, '?'],
    [undefined, '?'],
  ])('%s → %s', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})

describe('centreSquare', () => {
  it('takes the middle of a landscape image', () => {
    expect(centreSquare(800, 600)).toEqual({ x: 100, y: 0, side: 600 })
  })

  it('takes the middle of a portrait image', () => {
    expect(centreSquare(600, 1000)).toEqual({ x: 0, y: 200, side: 600 })
  })

  it('keeps a square image whole', () => {
    expect(centreSquare(512, 512)).toEqual({ x: 0, y: 0, side: 512 })
  })
})
