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

// Private channels (Broadcast and Presence) ------------------------------------------
// These don't go through table RLS: Realtime checks the policies on
// realtime.messages for the channel's name when a client joins (see the
// chat_ux migration). Channel names are fixed ("conversation:<id>",
// "user:<id>"), and realtime-js hands back the existing channel for a name
// that is still leaving, so one channel per name is shared here: listeners
// come and go, and the channel is removed a moment after the last one leaves
// (a quick remount, like React's StrictMode, keeps it).

type PresenceState = Record<string, unknown[]>

export type PrivateListener = {
  onBroadcast?: (event: string, payload: Record<string, unknown>) => void
  onPresence?: (state: PresenceState) => void
  onState?: (state: LiveState) => void
}

type Shared = {
  channel: ReturnType<typeof supabase.channel>
  listeners: Set<PrivateListener>
  state: LiveState
  presence: PresenceState
  removal?: ReturnType<typeof setTimeout>
}

const shared = new Map<string, Shared>()

export type PrivateChannel = {
  send: (event: string, payload: Record<string, unknown>) => void
  track: (payload: Record<string, unknown>) => void
  leave: () => void
}

/**
 * Joins (or shares) a private channel. `presence` turns Presence on for it;
 * `presence.key` is the key you announce under (only on your own channel).
 */
export function joinPrivate(
  topic: string,
  listener: PrivateListener,
  options: { presence?: { key?: string } } = {},
): PrivateChannel {
  let entry = shared.get(topic)
  if (entry?.removal) {
    clearTimeout(entry.removal)
    entry.removal = undefined
  }
  if (!entry) {
    const channel = supabase.channel(topic, {
      config: {
        private: true,
        broadcast: { self: false },
        ...(options.presence && { presence: { key: options.presence.key ?? '' } }),
      },
    })
    const created: Shared = { channel, listeners: new Set(), state: 'connecting', presence: {} }
    channel.on('broadcast', { event: '*' }, (message) =>
      created.listeners.forEach((l) => l.onBroadcast?.(message.event, message.payload ?? {})),
    )
    // Only bind Presence where wanted: with it on, Realtime also checks the
    // presence policies when joining.
    if (options.presence) {
      channel.on('presence', { event: 'sync' }, () => {
        created.presence = channel.presenceState()
        created.listeners.forEach((l) => l.onPresence?.(created.presence))
      })
    }
    channel.subscribe((status) => {
      const wasLive = created.state !== 'connecting'
      created.state = status === 'SUBSCRIBED' ? 'live' : wasLive ? 'reconnecting' : 'connecting'
      created.listeners.forEach((l) => l.onState?.(created.state))
    })
    shared.set(topic, created)
    entry = created
  }

  const current = entry
  current.listeners.add(listener)
  listener.onState?.(current.state)
  if (Object.keys(current.presence).length) listener.onPresence?.(current.presence)

  return {
    send: (event, payload) => void current.channel.send({ type: 'broadcast', event, payload }),
    track: (payload) => void current.channel.track(payload),
    leave: () => {
      current.listeners.delete(listener)
      if (current.listeners.size > 0) return
      current.removal = setTimeout(() => {
        shared.delete(topic)
        void supabase.removeChannel(current.channel)
      }, 1000)
    },
  }
}
