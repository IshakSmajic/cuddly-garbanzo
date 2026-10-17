import { describe, expect, it } from 'vitest'
import type { Message } from '../lib/messageRules.ts'
import type { ConversationSummary } from '../lib/messages.ts'
import { chatPreview, withMessage } from './chatList.ts'

const chat = (id: string, last_at: string | null, unread_count = 0): ConversationSummary => ({
  conversation_id: id,
  other_id: `other-${id}`,
  username: id,
  display_name: id,
  avatar_path: null,
  is_friend: true,
  last_content: null,
  last_sender_id: null,
  last_at,
  unread_count,
})
const message = (conversation_id: string, sender_id: string, created_at: string): Message => ({
  id: 1,
  conversation_id,
  sender_id,
  client_id: 'c',
  content: 'hello',
  created_at,
})

describe('withMessage', () => {
  const list = [chat('a', '2026-10-16T08:00:00+00:00'), chat('b', '2026-10-16T07:00:00+00:00', 2)]

  it('moves the chat to the top with the new message as preview', () => {
    const next = withMessage(list, message('b', 'them', '2026-10-16T09:00:00+00:00'), 'me')
    expect(next.map((c) => c.conversation_id)).toEqual(['b', 'a'])
    expect(next[0]).toMatchObject({ last_content: 'hello', last_sender_id: 'them' })
  })

  it("counts someone else's message as unread, not your own", () => {
    expect(withMessage(list, message('b', 'them', '2026-10-16T09:00:00+00:00'), 'me')[0]?.unread_count).toBe(3)
    expect(withMessage(list, message('b', 'me', '2026-10-16T09:00:00+00:00'), 'me')[0]?.unread_count).toBe(2)
  })

  it('counts a deleted user’s message (no sender) as unread', () => {
    expect(withMessage(list, { ...message('a', 'x', '2026-10-16T09:00:00+00:00'), sender_id: null }, 'me')[0]?.unread_count).toBe(1)
  })

  it('orders by microseconds, not by text', () => {
    const close = [chat('a', '2026-10-16T08:00:00.1+00:00'), chat('b', '2026-10-16T08:00:00.05+00:00')]
    const next = withMessage(close, message('b', 'them', '2026-10-16T08:00:00.12+00:00'), 'me')
    expect(next.map((c) => c.conversation_id)).toEqual(['b', 'a'])
  })
})

describe('chatPreview', () => {
  const last = { last_at: '2026-10-16T09:00:00+00:00', last_sender_id: 'them' }

  it('says so when there are no messages', () => {
    expect(chatPreview(chat('a', null), 'me')).toBe('No messages yet')
  })

  it('shows the last text, marking your own', () => {
    expect(chatPreview({ ...chat('a', null), ...last, last_content: 'hi' }, 'me')).toBe('hi')
    expect(chatPreview({ ...chat('a', null), ...last, last_content: 'hi', last_sender_id: 'me' }, 'me')).toBe('You: hi')
  })

  it('shows "Photo" for an image without a caption', () => {
    expect(chatPreview({ ...chat('a', null), ...last }, 'me')).toBe('Photo')
    expect(chatPreview({ ...chat('a', null), ...last, last_sender_id: 'me' }, 'me')).toBe('You: Photo')
  })
})
