/** Where confirmation emails send people back to. Must be in Auth's redirect allow-list. */
export function emailRedirectUrl(): string {
  return `${window.location.origin}/`
}

/** Where password-reset emails send people back to. Must be in Auth's redirect allow-list. */
export function passwordResetUrl(): string {
  return `${window.location.origin}/reset-password`
}
