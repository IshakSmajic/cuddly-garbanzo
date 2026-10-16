// Search, friend requests and blocks. Every change goes through a database
// function (supabase/migrations/*_friend_requests.sql), which enforces who may
// do what; this file wraps those calls and turns their error codes into
// sentences.
import type { Profile } from '../auth/context.ts'
import { friendErrorMessage } from './friendRules.ts'
import { supabase } from './supabase.ts'

/** How the signed-in user relates to someone. "blocked" means you blocked them. */
export type Relation = 'none' | 'outgoing' | 'incoming' | 'friends' | 'blocked'

export type Person = Pick<Profile, 'user_id' | 'username' | 'display_name' | 'avatar_path'>

export type RelationState = { relation: Relation; request_id: string | null }

export type SearchResult = Person & RelationState

export type PendingRequest = { id: string; created_at: string; person: Person }

type Result<T> = { data: T | null; error: { code?: string; message?: string } | null }

async function call<T>(request: PromiseLike<Result<T>>): Promise<T | null> {
  const { data, error } = await request
  if (error) throw new Error(friendErrorMessage(error))
  return data
}

export async function searchUsers(query: string): Promise<SearchResult[]> {
  const rows = (await call(supabase.rpc('search_users', { query }))) ?? []
  return rows.map((row) => ({ ...row, relation: row.relation as Relation }))
}

export async function relationshipWith(userId: string): Promise<RelationState> {
  const rows = await call(supabase.rpc('relationship_with', { other: userId }))
  const row = rows?.[0]
  return { relation: (row?.relation ?? 'none') as Relation, request_id: row?.request_id ?? null }
}

export async function sendRequest(userId: string): Promise<void> {
  await call(supabase.rpc('send_friend_request', { recipient: userId }))
}

export async function respondToRequest(requestId: string, accept: boolean): Promise<void> {
  await call(supabase.rpc('respond_to_friend_request', { request_id: requestId, accept }))
}

export async function cancelRequest(requestId: string): Promise<void> {
  await call(supabase.rpc('cancel_friend_request', { request_id: requestId }))
}

export async function blockUser(userId: string): Promise<void> {
  await call(supabase.rpc('block_user', { target: userId }))
}

export async function unblockUser(userId: string): Promise<void> {
  await call(supabase.rpc('unblock_user', { target: userId }))
}

const PERSON = 'user_id, username, display_name, avatar_path'

/** Your pending requests, both ways. RLS returns only rows you're part of. */
export async function pendingRequests(userId: string) {
  const rows =
    (await call(
      supabase
        .from('friend_requests')
        .select(
          `id, created_at, requester_id,
         requester:profiles!friend_requests_requester_id_fkey(${PERSON}),
         recipient:profiles!friend_requests_recipient_id_fkey(${PERSON})`,
        )
        .eq('status', 'pending')
        .order('created_at', { ascending: false }),
    )) ?? []
  const incoming: PendingRequest[] = []
  const outgoing: PendingRequest[] = []
  for (const row of rows) {
    if (row.requester_id === userId) outgoing.push({ id: row.id, created_at: row.created_at, person: row.recipient })
    else incoming.push({ id: row.id, created_at: row.created_at, person: row.requester })
  }
  return { incoming, outgoing }
}

export async function incomingRequestCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('friend_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .eq('recipient_id', userId)
  if (error) throw new Error(friendErrorMessage(error))
  return count ?? 0
}

// Until realtime arrives (milestone 7), screens tell each other about changes
// they made, so the header's request count stays current.
const CHANGED = 'thread:friends-changed'

export function notifyFriendsChanged() {
  window.dispatchEvent(new Event(CHANGED))
}

export function onFriendsChanged(listener: () => void): () => void {
  window.addEventListener(CHANGED, listener)
  return () => window.removeEventListener(CHANGED, listener)
}
