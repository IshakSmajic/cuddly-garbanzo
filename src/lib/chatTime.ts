// How times read in the chat list and the chat itself. Uses the browser's
// locale; `now` is a parameter so the rules can be tested.

const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' })
const longDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whole calendar days between the two dates, in local time (0 = same day). */
export function daysAgo(date: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
}

/** "14:05" — under each message. */
export function messageTime(timestamp: string): string {
  return time.format(new Date(timestamp))
}

/** Separator between days in a chat: "Today", "Yesterday", "Monday", "3 Oct", "3 Oct 2025". */
export function dayLabel(timestamp: string, now = new Date()): string {
  const date = new Date(timestamp)
  const days = daysAgo(date, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days > 1 && days < 7) return weekday.format(date)
  return date.getFullYear() === now.getFullYear() ? shortDate.format(date) : longDate.format(date)
}

/** Chat list: the time today, otherwise the day. */
export function listTime(timestamp: string, now = new Date()): string {
  return daysAgo(new Date(timestamp), now) === 0 ? messageTime(timestamp) : dayLabel(timestamp, now)
}

export function sameDay(a: string, b: string): boolean {
  return daysAgo(new Date(a), new Date(b)) === 0
}
