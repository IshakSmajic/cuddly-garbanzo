import { describe, expect, it } from 'vitest'
import { bubbleImageWidth, fitWithin, imageFileError, imagePath } from './images.ts'

describe('imageFileError', () => {
  it('accepts JPEG, PNG and WebP up to 20 MB', () => {
    expect(imageFileError({ type: 'image/jpeg', size: 20 * 1024 * 1024 })).toBeNull()
    expect(imageFileError({ type: 'image/png', size: 1 })).toBeNull()
    expect(imageFileError({ type: 'image/webp', size: 1 })).toBeNull()
  })

  it('refuses other types and larger files', () => {
    expect(imageFileError({ type: 'image/gif', size: 1 })).toMatch(/JPEG, PNG or WebP/)
    expect(imageFileError({ type: 'application/pdf', size: 1 })).toMatch(/JPEG, PNG or WebP/)
    expect(imageFileError({ type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 })).toMatch(/too large/)
  })
})

describe('fitWithin', () => {
  it('scales the longest side down to the limit, keeping the shape', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2048, height: 1536 })
    expect(fitWithin(3024, 4032)).toEqual({ width: 1536, height: 2048 })
  })

  it('leaves small images alone', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('never rounds a side down to zero', () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 2048, height: 1 })
  })
})

describe('bubbleImageWidth', () => {
  it('limits wide images by width and tall ones by height', () => {
    expect(bubbleImageWidth(2048, 1536)).toBe(280)
    expect(bubbleImageWidth(1536, 2048)).toBe(240) // 320 tall
  })

  it('never shows a small image larger than it is', () => {
    expect(bubbleImageWidth(100, 80)).toBe(100)
  })
})

describe('imagePath', () => {
  it('puts the file in the conversation folder with a random name', () => {
    const conversation = '0b7c3c1e-2f4b-4a51-9d7e-6a0f2b1c9e10'
    const path = imagePath(conversation, 'webp')
    expect(path).toMatch(/^0b7c3c1e-2f4b-4a51-9d7e-6a0f2b1c9e10\/[0-9a-f-]{36}\.webp$/)
    expect(imagePath(conversation, 'webp')).not.toBe(path)
  })
})
