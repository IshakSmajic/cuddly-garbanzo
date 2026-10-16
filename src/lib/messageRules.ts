// Message rules that don't need the network. The calls are in messages.ts;
// the CHECK constraint and insert policy on public.messages are the real
// gatekeeper.

export const MESSAGE_MAX = 4000 // matches messages_content
/** Show the counter only once it matters. */
export const COUNTER_FROM = 3500

export type Message = {
  id: number
  conversation_id: string
  sender_id: string | null
  client_id: string
  content: string | null
  created_at: string
}

/** What gets sent: spaces and line breaks at the ends are dropped. */
export function prepareMessage(text: string): string {
  return text.trim()
}

/** Counted as PostgreSQL's char_length does (code points), on the trimmed text. */
export function messageLength(text: string): number {
  return [...prepareMessage(text)].length
}

export function messageError(text: string): string | null {
  if (messageLength(text) > MESSAGE_MAX) return `Messages are at most ${MESSAGE_MAX.toLocaleString('en')} characters.`
  return null
}

export function canSend(text: string): boolean {
  return messageLength(text) > 0 && !messageError(text)
}

/**
 * Microseconds since 1970 from a PostgREST timestamp such as
 * "2026-10-16T07:01:02.123456+00:00". Date keeps only milliseconds, and two
 * messages can share a millisecond, so the fraction is read separately.
 */
export function timeKey(timestamp: string): number {
  const match = timestamp.match(/^(.*?)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)?$/)
  if (!match) return NaN
  const [, whole, fraction = '', zone = 'Z'] = match
  const micros = Number(fraction.padEnd(6, '0').slice(0, 6))
  return Date.parse(whole + zone) * 1000 + micros
}

/** Display order: oldest first, by (created_at, id) like the database. */
export function compareMessages(a: Message, b: Message): number {
  return timeKey(a.created_at) - timeKey(b.created_at) || a.id - b.id
}

/** Adds messages, dropping any already present (same id), keeping the order. */
export function mergeMessages(existing: Message[], incoming: Message[]): Message[] {
  const byId = new Map(existing.map((m) => [m.id, m]))
  for (const m of incoming) byId.set(m.id, m)
  return [...byId.values()].sort(compareMessages)
}
