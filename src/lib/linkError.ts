// When an email link fails (expired, already used), Supabase redirects back
// with the reason in the URL hash. Read it once at startup, before the router
// redirects and drops the hash, so the sign-in page can explain what happened.
function readLinkError(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return params.get('error_description')
}

export const linkError = readLinkError()
