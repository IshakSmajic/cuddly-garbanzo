import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { Field } from '../components/Field.tsx'
import { linkError } from '../lib/linkError.ts'
import { supabase } from '../lib/supabase.ts'

export function SignIn() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(
    linkError ? `That link didn't work: ${linkError}. Sign in, or request a new one.` : null,
  )
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setSubmitting(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setSubmitting(false)

    if (!error) return // AuthProvider sees the new session and the gate redirects.

    if (error.code === 'email_not_confirmed') {
      navigate('/check-email', { state: { email: email.trim(), unconfirmed: true } })
    } else if (error.code === 'invalid_credentials') {
      // Same message whether the email exists or not.
      setError('Invalid email or password.')
    } else {
      setError('Something went wrong. Please try again.')
    }
  }

  return (
    <AuthLayout eyebrow="Welcome back" title="Sign in." subtitle="Continue to your conversations.">
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
          autoComplete="current-password"
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" arrow disabled={submitting}>
          {submitting ? 'Signing in…' : 'Enter Thread'}
        </Button>
      </form>
      <p className="auth-switch">
        New to Thread? <Link to="/sign-up">Create an account</Link>
      </p>
    </AuthLayout>
  )
}
