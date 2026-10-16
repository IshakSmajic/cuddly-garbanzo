import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { onFriendsChanged } from '../lib/friends.ts'
import type { Message } from '../lib/messageRules.ts'
import { myConversations, type ConversationSummary } from '../lib/messages.ts'
import { joinPrivate, onResume, subscribe, type PrivateChannel } from '../lib/realtime.ts'
import { ChatsContext, type ChatsValue } from './chats.ts'
import { withMessage } from './chatList.ts'

const TITLE = 'Thread Buddies'

/**
 * Wraps every signed-in page. Keeps one chat list (with unread counts) and
 * friends' online status for the whole app, so these subscriptions and your
 * own presence don't restart on every page change.
 */
export function AppShell() {
  const { session } = useAuth()
  const me = session?.user.id
  const [chats, setChats] = useState<ConversationSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [online, setOnline] = useState<ReadonlySet<string>>(new Set())
  const shown = useRef(chats)
  useEffect(() => {
    shown.current = chats
  }, [chats])

  const reload = useCallback(() => {
    myConversations().then(
      (list) => {
        setChats(list)
        setError(null)
      },
      (e: Error) => setError(e.message),
    )
  }, [])

  // The chat list, live.
  useEffect(() => {
    if (!me) return
    reload()
    const stopMessages = subscribe<Message>({
      table: 'messages',
      event: 'INSERT',
      onChange: (payload) => {
        const m = payload.new as Message
        // A conversation we don't know (a friendship made elsewhere): reload.
        if (!shown.current?.some((c) => c.conversation_id === m.conversation_id)) return reload()
        setChats((cs) => cs && withMessage(cs, m, me))
      },
      onReady: reload,
    })
    // One of your requests accepted: a new chat exists.
    const stopRequests = subscribe({
      table: 'friend_requests',
      event: 'UPDATE',
      onChange: (payload) => (payload.new as { status: string }).status === 'accepted' && reload(),
    })
    const stopResume = onResume(reload)
    const stopFriends = onFriendsChanged(reload)
    return () => {
      stopMessages()
      stopRequests()
      stopResume()
      stopFriends()
    }
  }, [me, reload])

  // Announce yourself on your own presence channel; your friends watch it.
  useEffect(() => {
    if (!me) return
    // Presence isn't restored by a rejoin, so announce on every (re)connect.
    // (joinPrivate reports the current state at once, before `own` is set; a
    // channel that is already live kept its earlier announcement.)
    let own: PrivateChannel | undefined
    own = joinPrivate(
      `user:${me}`,
      { onState: (state) => state === 'live' && own?.track({ online_at: new Date().toISOString() }) },
      { presence: { key: me } },
    )
    return () => own?.leave()
  }, [me])

  // Watch each current friend's channel. Only friends may join (policy), and
  // a friend who becomes a former friend is dropped when the list reloads.
  const friendIds = useMemo(
    () =>
      (chats ?? [])
        .filter((c) => c.is_friend && c.other_id)
        .map((c) => c.other_id as string)
        .sort()
        .join(','),
    [chats],
  )
  useEffect(() => {
    if (!friendIds) return
    const channels = friendIds.split(',').map((id) =>
      joinPrivate(
        `user:${id}`,
        {
          onPresence: (state) =>
            setOnline((previous) => {
              const next = new Set(previous)
              if (state[id]?.length) next.add(id)
              else next.delete(id)
              return next
            }),
        },
        { presence: {} },
      ),
    )
    return () => channels.forEach((c) => c.leave())
  }, [friendIds])

  // "(3) Thread Buddies" while anything is unread.
  const unread = (chats ?? []).reduce((sum, c) => sum + c.unread_count, 0)
  useEffect(() => {
    document.title = unread > 0 ? `(${unread}) ${TITLE}` : TITLE
    return () => {
      document.title = TITLE
    }
  }, [unread])

  const markedRead = useCallback(
    (conversationId: string) =>
      setChats((cs) => cs && cs.map((c) => (c.conversation_id === conversationId ? { ...c, unread_count: 0 } : c))),
    [],
  )

  const value = useMemo<ChatsValue>(
    () => ({
      chats,
      error,
      reload,
      markedRead,
      // Only current friends count: a former friend's last state is ignored.
      isOnline: (userId) => Boolean(userId && online.has(userId) && friendIds.split(',').includes(userId)),
    }),
    [chats, error, reload, markedRead, online, friendIds],
  )

  return (
    <ChatsContext value={value}>
      <Outlet />
    </ChatsContext>
  )
}
