import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { supabase } from '../lib/supabase.ts'
import { emailRedirectUrl } from '../lib/urls.ts'
import { useCooldown } from '../lib/useCooldown.ts'

type LocationState = { email?: string; unconfirmed?: boolean } | null

export function CheckEmail() {
  const state = useLocation().state as LocationState
  const email = state?.email
  const [cooldown, startCooldown] = useCooldown()
  const [message, setMessage] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  // Reached directly (no email in navigation state): nothing to show.
  if (!email) return <Navigate to="/sign-up" replace />

  async function resend() {
    if (!email) return
    setSending(true)
    setMessage(null)
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: emailRedirectUrl() },
    })
    setSending(false)
    if (error) {
      setMessage(
        error.code === 'over_email_send_rate_limit'
          ? 'Please wait a minute before requesting another email.'
          : 'Could not send the email. Please try again.',
      )
    } else {
      setMessage('Sent. Check your inbox and spam folder.')
      startCooldown()
    }
  }

  return (
    <AuthLayout
      eyebrow={state.unconfirmed ? 'One more thing' : 'Almost there'}
      title="Check your inbox."
      subtitle={
        <>
          {state.unconfirmed ? 'Confirm your email before signing in. ' : ''}
          We sent a confirmation link to <strong className="text-strong">{email}</strong>. Open
          it to continue.
        </>
      }
    >
      <div className="auth-fields">
        {message && (
          <p className="form-note" role="status">
            {message}
          </p>
        )}
        <Button variant="secondary" onClick={resend} disabled={sending || cooldown > 0}>
          {sending ? 'Sending…' : cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
        </Button>
      </div>
      <p className="auth-switch">
        Wrong address? <Link to="/sign-up">Start over</Link>
      </p>
    </AuthLayout>
  )
}
