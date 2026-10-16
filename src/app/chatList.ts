import { timeKey, type Message } from '../lib/messageRules.ts'
import type { ConversationSummary } from '../lib/messages.ts'

/**
 * The chat list after `m` arrived: that chat shows it as its last message,
 * counts it as unread if someone else sent it, and moves to the top.
 */
export function withMessage(chats: ConversationSummary[], m: Message, me: string): ConversationSummary[] {
  return chats
    .map((c) =>
      c.conversation_id === m.conversation_id
        ? {
            ...c,
            last_content: m.content,
            last_sender_id: m.sender_id,
            last_at: m.created_at,
            unread_count: c.unread_count + (m.sender_id === me ? 0 : 1),
          }
        : c,
    )
    .sort((a, b) => (b.last_at ? timeKey(b.last_at) : 0) - (a.last_at ? timeKey(a.last_at) : 0))
}
