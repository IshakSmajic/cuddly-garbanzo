// Conversations and messages. Reading needs membership and sending needs a
// current friendship; both are enforced by RLS on public.messages
// (supabase/migrations/*_messages.sql). This file wraps the calls.
import type { Message } from './messageRules.ts'
import { supabase } from './supabase.ts'

export const PAGE_SIZE = 50

export type ConversationSummary = {
  conversation_id: string
  /** Null once the other person deleted their account. */
  other_id: string | null
  username: string | null
  display_name: string | null
  avatar_path: string | null
  is_friend: boolean
  last_content: string | null
  last_sender_id: string | null
  last_at: string | null
}

/** Every conversation you're in, the most recently active first. */
export async function myConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('my_conversations')
  if (error) throw new Error("Couldn't load your chats.")
  return data ?? []
}

/** One conversation, or null if it doesn't exist or you're not in it. */
export async function conversationSummary(conversationId: string): Promise<ConversationSummary | null> {
  const { data, error } = await supabase.rpc('my_conversations', { only_conversation: conversationId })
  if (error) throw new Error("Couldn't load this chat.")
  return data?.[0] ?? null
}

/** The conversation you share with someone (every friendship has one). */
export async function conversationWith(otherId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('direct_conversations')
    .select('conversation_id')
    .or(`user_low_id.eq.${otherId},user_high_id.eq.${otherId}`)
    .maybeSingle()
  if (error) throw new Error("Couldn't open the chat.")
  return data?.conversation_id ?? null
}

/** The newest page, or the page before `before` (keyset paging). Oldest first. */
export async function messagesPage(conversationId: string, before?: Message): Promise<Message[]> {
  const { data, error } = await supabase.rpc('messages_page', {
    conversation: conversationId,
    ...(before && { before_created_at: before.created_at, before_id: before.id }),
    page_size: PAGE_SIZE,
  })
  if (error) throw new Error("Couldn't load messages.")
  return (data ?? []).reverse()
}

export class SendError extends Error {
  /** True when sending is no longer allowed (unfriended or blocked meanwhile). */
  readonly notAllowed: boolean
  constructor(message: string, notAllowed = false) {
    super(message)
    this.notAllowed = notAllowed
  }
}

/**
 * Sends a message. `clientId` is made once per message by the caller and
 * reused on every retry: if an earlier attempt did reach the database (and
 * only the answer was lost), the retry hits UNIQUE (sender_id, client_id) and
 * we fetch the stored message instead of creating a second one.
 */
export async function sendMessage(conversationId: string, clientId: string, content: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ conversation_id: conversationId, client_id: clientId, content })
    .select()
    .single()
  if (!error) return data
  if (error.code === '23505') {
    // RLS limits this to messages you can read; client ids are random UUIDs.
    const { data: stored, error: fetchError } = await supabase
      .from('messages')
      .select()
      .eq('client_id', clientId)
      .eq('conversation_id', conversationId)
      .single()
    if (!fetchError) return stored
  }
  if (error.code === '42501') throw new SendError("You can't send messages in this chat any more.", true)
  if (error.code === '23514') throw new SendError('Messages must be 1 to 4,000 characters.')
  throw new SendError("Couldn't send. Check your connection and try again.")
}
