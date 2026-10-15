import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { Field } from '../components/Field.tsx'
import { supabase } from '../lib/supabase.ts'
import { newPasswordError, PASSWORD_MIN } from '../lib/validation.ts'

// Reached from the reset email: the link signs the user in with a recovery
// session, so this page only needs a session (Gate area "account"). The server
// decides whether a password change is allowed (secure_password_change).
export function ResetPassword() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const invalid = newPasswordError(password, confirm)
    if (invalid) {
      setError(invalid)
      return
    }
    setSubmitting(true)
    setError(null)
    // On success, Supabase Auth also revokes every other session's refresh
    // token, so a device someone else had signed in on is logged out.
    const { error } = await supabase.auth.updateUser({ password })
    setSubmitting(false)

    if (error) {
      if (error.code === 'same_password') {
        setError('That is your current password. Choose a different one.')
      } else if (error.code === 'weak_password') {
        setError(error.message)
      } else if (error.code === 'reauthentication_needed') {
        setError('This session is too old to change the password. Request a new reset link.')
      } else {
        setError('Something went wrong. Please try again.')
      }
      return
    }
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout
      eyebrow="Password reset"
      title="New password."
      subtitle="Choose a new password. Other devices will be signed out."
    >
      <form className="auth-fields" onSubmit={onSubmit} noValidate>
        <Field
          label="New password"
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
        <Field
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" arrow disabled={submitting}>
          {submitting ? 'Saving…' : 'Save password'}
        </Button>
      </form>
      <p className="auth-switch">
        Changed your mind? <Link to="/">Go back</Link>
      </p>
    </AuthLayout>
  )
}
