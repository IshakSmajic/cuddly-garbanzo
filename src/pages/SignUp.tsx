import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { Field } from '../components/Field.tsx'
import { supabase } from '../lib/supabase.ts'
import { emailRedirectUrl } from '../lib/urls.ts'

const PASSWORD_MIN = 8 // matches auth.minimum_password_length

export function SignUp() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    if (password.length < PASSWORD_MIN) {
      setError(`Use at least ${PASSWORD_MIN} characters for your password.`)
      return
    }
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { emailRedirectTo: emailRedirectUrl() },
    })
    setSubmitting(false)

    if (!error) {
      // Also reached when the email is already registered: Supabase answers the
      // same way, so this page never reveals which addresses have accounts.
      navigate('/check-email', { state: { email: email.trim() } })
    } else if (error.code === 'weak_password') {
      setError(error.message)
    } else if (error.code === 'validation_failed' || error.code === 'email_address_invalid') {
      setError('Enter a valid email address.')
    } else if (error.code === 'over_email_send_rate_limit') {
      setError('Too many emails sent. Wait a minute and try again.')
    } else {
      setError('Something went wrong. Please try again.')
    }
  }

  return (
    <AuthLayout
      eyebrow="New here"
      title="Create account."
      subtitle="Just an email and a password. You'll pick a username next."
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
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={`At least ${PASSWORD_MIN} characters.`}
          invalid={passwordTooShort}
          minLength={PASSWORD_MIN}
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" arrow disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="auth-switch">
        Already on Thread? <Link to="/sign-in">Sign in</Link>
      </p>
    </AuthLayout>
  )
}
