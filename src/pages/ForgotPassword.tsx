import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { Field } from '../components/Field.tsx'
import { supabase } from '../lib/supabase.ts'
import { passwordResetUrl } from '../lib/urls.ts'
import { useCooldown } from '../lib/useCooldown.ts'

type LocationState = { email?: string } | null

export function ForgotPassword() {
  const state = useLocation().state as LocationState
  const [email, setEmail] = useState(state?.email ?? '')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [cooldown, startCooldown] = useCooldown()

  async function send(address: string) {
    setSending(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(address, {
      redirectTo: passwordResetUrl(),
    })
    setSending(false)

    // Supabase also answers "ok" for addresses with no account, and we show the
    // same message, so this page never reveals which addresses have accounts.
    if (!error) {
      setSentTo(address)
      startCooldown()
    } else if (error.code === 'over_email_send_rate_limit' || error.status === 429) {
      setError('Too many emails sent. Wait a minute and try again.')
    } else if (error.code === 'validation_failed' || error.code === 'email_address_invalid') {
      setError('Enter a valid email address.')
    } else {
      setError('Something went wrong. Please try again.')
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    void send(email.trim())
  }

  if (sentTo) {
    return (
      <AuthLayout
        eyebrow="Password reset"
        title="Check your inbox."
        subtitle={
          <>
            If an account exists for <strong className="text-strong">{sentTo}</strong>, we sent a
            link to choose a new password. It works once, for one hour.
          </>
        }
      >
        <div className="auth-fields">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <Button
            variant="secondary"
            onClick={() => void send(sentTo)}
            disabled={sending || cooldown > 0}
          >
            {sending ? 'Sending…' : cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
          </Button>
        </div>
        <p className="auth-switch">
          Remembered it? <Link to="/sign-in">Sign in</Link>
        </p>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      eyebrow="Password reset"
      title="Forgot password."
      subtitle="Enter your email and we'll send you a link to choose a new one."
    >
      <form className="auth-fields" onSubmit={onSubmit} noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" arrow disabled={sending}>
          {sending ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
      <p className="auth-switch">
        Remembered it? <Link to="/sign-in">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
