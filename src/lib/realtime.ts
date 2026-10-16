// Live database changes over Supabase Realtime (postgres_changes).
//
// The browser keeps one WebSocket to Realtime; each subscription here is a
// channel on it. Realtime checks every insert and update against the
// subscriber's SELECT policy, so you only receive rows you could query.
// supabase-js sends heartbeats, reconnects and rejoins channels by itself,
// and passes the refreshed access token on when the session renews.
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { supabase } from './supabase.ts'

/** "connecting" until the first ready; "reconnecting" whenever it drops after that. */
export type LiveState = 'connecting' | 'live' | 'reconnecting'

type Row = Record<string, unknown>

type Options<T extends Row> = {
  table: 'messages' | 'friend_requests'
  event: 'INSERT' | 'UPDATE' | '*'
  /** e.g. `conversation_id=eq.<id>`; RLS applies either way. */
  filter?: string
  onChange: (payload: RealtimePostgresChangesPayload<T>) => void
  /**
   * Called each time changes start flowing: first subscribe and every
   * reconnect. Anything that happened while not listening was missed, so
   * this is where to re-fetch.
   */
  onReady?: () => void
  onState?: (state: LiveState) => void
}

export function subscribe<T extends Row>({ table, event, filter, onChange, onReady, onState }: Options<T>): () => void {
  let wasLive = false
  // A unique name: supabase-js reuses a channel with the same name.
  const channel = supabase
    .channel(`${table}:${filter ?? 'all'}:${crypto.randomUUID()}`)
    .on<T>(
      'postgres_changes',
      { event: event as '*', schema: 'public', table, ...(filter && { filter }) },
      onChange,
    )
    // SUBSCRIBED only means the channel joined. Changes flow once Realtime has
    // registered the subscription in Postgres, which it announces with this
    // system message; inserts before it are not delivered.
    .on('system', {}, (payload: { extension?: string; status?: string }) => {
      if (payload.extension !== 'postgres_changes' || payload.status !== 'ok') return
      wasLive = true
      onState?.('live')
      onReady?.()
    })
    .subscribe((status) => {
      // CHANNEL_ERROR, TIMED_OUT or CLOSED: supabase-js retries on its own.
      if (status !== 'SUBSCRIBED') onState?.(wasLive ? 'reconnecting' : 'connecting')
    })
  return () => void supabase.removeChannel(channel)
}

/** Runs `callback` when the tab becomes visible again or the browser comes back online. */
export function onResume(callback: () => void): () => void {
  const visible = () => document.visibilityState === 'visible' && callback()
  document.addEventListener('visibilitychange', visible)
  window.addEventListener('online', callback)
  return () => {
    document.removeEventListener('visibilitychange', visible)
    window.removeEventListener('online', callback)
  }
}
