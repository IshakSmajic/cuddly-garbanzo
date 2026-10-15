import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context.ts'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { Field } from '../components/Field.tsx'
import { supabase } from '../lib/supabase.ts'
import { availabilityHint, useUsernameCheck } from '../lib/useUsernameCheck.ts'
import {
  DISPLAY_NAME_MAX,
  displayNameError,
  normalizeUsername,
  USERNAME_MAX,
} from '../lib/validation.ts'

export function Onboarding() {
  const { session, refreshProfile } = useAuth()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const { formatError, availability, markTaken } = useUsernameCheck(username)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const nameError = displayName ? displayNameError(displayName) : null

  const usernameHint =
    formatError ??
    availabilityHint(username, availability, 'Letters, numbers and underscores. You can change it later.')

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return
    const problem =
      (username ? formatError : 'Choose a username.') ??
      (availability === 'taken' ? `@${username} is taken. Try another.` : null) ??
      displayNameError(displayName)
    if (problem) {
      setError(problem)
      return
    }
    setSubmitting(true)
    setError(null)
    const { error } = await supabase
      .from('profiles')
      .update({ username, display_name: displayName.trim() })
      .eq('user_id', session.user.id)

    if (error) {
      setSubmitting(false)
      if (error.code === '23505') {
        markTaken(username) // someone claimed it since the check
      } else {
        setError('Could not save your profile. Please try again.')
      }
      return
    }
    // The gate sends the user on once the profile has a username.
    await refreshProfile()
  }

  return (
    <AuthLayout
      eyebrow="One last step"
      title="Pick your name."
      subtitle="Friends find you by username and see your display name."
    >
      <form className="auth-fields" onSubmit={onSubmit} noValidate>
        <Field
          label="Username"
          prefix="@"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="your_name"
          maxLength={USERNAME_MAX + 5}
          value={username}
          onChange={(e) => setUsername(normalizeUsername(e.target.value))}
          hint={usernameHint}
          invalid={Boolean(formatError) || availability === 'taken'}
          required
        />
        <Field
          label="Display name"
          autoComplete="name"
          placeholder="Your Name"
          maxLength={DISPLAY_NAME_MAX + 10}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          hint={nameError ?? undefined}
          invalid={Boolean(nameError)}
          required
        />
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" arrow disabled={submitting}>
          {submitting ? 'Saving…' : 'Continue'}
        </Button>
      </form>
      <p className="auth-switch">
        Not you?{' '}
        <button className="link-button" onClick={() => void supabase.auth.signOut()}>
          Sign out
        </button>
      </p>
    </AuthLayout>
  )
}
