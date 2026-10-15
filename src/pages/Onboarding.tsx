import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/context.ts'
import { AuthLayout } from '../components/AuthLayout.tsx'
import { Button } from '../components/Button.tsx'
import { Field } from '../components/Field.tsx'
import { supabase } from '../lib/supabase.ts'
import {
  DISPLAY_NAME_MAX,
  displayNameError,
  normalizeUsername,
  usernameError,
  USERNAME_MAX,
} from '../lib/validation.ts'

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error'

export function Onboarding() {
  const { session, refreshProfile } = useAuth()
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  // Result of the last availability lookup, tagged with the name it was for.
  const [lookup, setLookup] = useState<{ username: string; result: Availability } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const formatError = username ? usernameError(username) : null
  const nameError = displayName ? displayNameError(displayName) : null

  const shouldCheck = username !== '' && !formatError
  const availability: Availability = !shouldCheck
    ? 'idle'
    : lookup?.username === username
      ? lookup.result
      : 'checking'

  // Check availability once typing pauses. This is only a hint: two people
  // can still race for the same name, and the UNIQUE constraint decides.
  useEffect(() => {
    if (!shouldCheck) return
    let stale = false
    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('user_id')
        .eq('username', username)
        .maybeSingle()
      if (!stale) setLookup({ username, result: error ? 'error' : data ? 'taken' : 'available' })
    }, 400)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [username, shouldCheck])

  const usernameHint =
    formatError ??
    {
      idle: 'Letters, numbers and underscores. You can change it later.',
      checking: 'Checking…',
      available: `@${username} is available.`,
      taken: `@${username} is taken.`,
      error: "Couldn't check availability.",
    }[availability]

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
        setLookup({ username, result: 'taken' }) // someone claimed it since the check
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
