/** Where confirmation emails send people back to. Must be in Auth's redirect allow-list. */
export function emailRedirectUrl(): string {
  return `${window.location.origin}/`
}
