import { createContext, use } from 'react'
import type { ConversationSummary } from '../lib/messages.ts'

export type ChatsValue = {
  /** Every conversation you're in, newest activity first (null while loading). */
  chats: ConversationSummary[] | null
  error: string | null
  reload: () => void
  /** Call after marking a conversation read, so its unread count clears at once. */
  markedRead: (conversationId: string) => void
  isOnline: (userId: string | null | undefined) => boolean
}

export const ChatsContext = createContext<ChatsValue | null>(null)

export function useChats(): ChatsValue {
  const value = use(ChatsContext)
  if (!value) throw new Error('useChats must be used inside <AppShell>')
  return value
}
