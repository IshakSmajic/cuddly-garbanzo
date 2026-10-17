// When an email link fails (expired, already used), Supabase redirects back
// with the reason in the URL hash. Read it once at startup, before the router
// redirects and drops the hash, so the sign-in page can say what happened.
//
// Only *whether* there was an error is used, never the text: anyone can
// craft a link to this site with any error_description, and showing it word
// for word would let them put their own message on our sign-in page.
function readLinkError(): boolean {
  const params = new URLSearchParams(window.location.hash.slice(1))
  return params.has('error') || params.has('error_description')
}

export const linkError = readLinkError()
