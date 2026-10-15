import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/context.ts'
import { AppHeader } from '../components/AppHeader.tsx'
import { Avatar } from '../components/Avatar.tsx'
import { Button } from '../components/Button.tsx'
import { Field, TextAreaField } from '../components/Field.tsx'
import { AVATAR_INPUT_TYPES, avatarFileError } from '../lib/avatar.ts'
import { changeAvatar, removeAvatar } from '../lib/avatarUpload.ts'
import { supabase } from '../lib/supabase.ts'
import { availabilityHint, useUsernameCheck } from '../lib/useUsernameCheck.ts'
import {
  BIO_MAX,
  bioError,
  bioLength,
  DISPLAY_NAME_MAX,
  displayNameError,
  normalizeUsername,
  USERNAME_MAX,
} from '../lib/validation.ts'

type Fields = { username: string; displayName: string; bio: string }

export function ProfileSettings() {
  const { session, profile, refreshProfile } = useAuth()
  // The gate only renders this page for an onboarded user, so these are set.
  const current: Fields = {
    username: profile?.username ?? '',
    displayName: profile?.display_name ?? '',
    bio: profile?.bio ?? '',
  }
  const [fields, setFields] = useState<Fields>(current)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // What was last saved; "Saved." shows until the form is edited again.
  const [saved, setSaved] = useState<Fields | null>(null)

  const { formatError, availability, markTaken } = useUsernameCheck(fields.username, profile?.username)
  const nameError = fields.displayName ? displayNameError(fields.displayName) : null
  const bioProblem = bioError(fields.bio)

  const set = (key: keyof Fields) => (value: string) => setFields((f) => ({ ...f, [key]: value }))
  const isSaved =
    saved !== null &&
    saved.username === fields.username &&
    saved.displayName === fields.displayName &&
    saved.bio === fields.bio

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session) return
    const problem =
      (fields.username ? formatError : 'Choose a username.') ??
      (availability === 'taken' ? `@${fields.username} is taken. Try another.` : null) ??
      displayNameError(fields.displayName) ??
      bioProblem
    if (problem) {
      setError(problem)
      return
    }
    setSaving(true)
    setError(null)
    const bio = fields.bio.trim()
    const { error } = await supabase
      .from('profiles')
      .update({ username: fields.username, display_name: fields.displayName.trim(), bio: bio || null })
      .eq('user_id', session.user.id)
    setSaving(false)

    if (error) {
      if (error.code === '23505') {
        markTaken(fields.username) // someone claimed it since the check
      } else {
        setError('Could not save your profile. Please try again.')
      }
      return
    }
    setSaved(fields)
    await refreshProfile()
  }

  return (
    <div className="home">
      <AppHeader />
      <main className="settings">
        <Link to="/" className="settings-back">
          Back to home
        </Link>
        <p className="eyebrow">Settings</p>
        <h1 className="auth-title">Your profile.</h1>
        <p className="auth-subtitle">Friends see your picture, display name and bio.</p>

        <AvatarEditor />

        <form className="auth-fields" onSubmit={onSubmit} noValidate>
          <Field
            label="Username"
            prefix="@"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={USERNAME_MAX + 5}
            value={fields.username}
            onChange={(e) => set('username')(normalizeUsername(e.target.value))}
            hint={formatError ?? availabilityHint(fields.username, availability, 'Friends find you by this.')}
            invalid={Boolean(formatError) || availability === 'taken'}
            required
          />
          <Field
            label="Display name"
            autoComplete="name"
            maxLength={DISPLAY_NAME_MAX + 10}
            value={fields.displayName}
            onChange={(e) => set('displayName')(e.target.value)}
            hint={nameError ?? undefined}
            invalid={Boolean(nameError)}
            required
          />
          <TextAreaField
            label="Bio"
            rows={4}
            placeholder="A line or two about you (optional)"
            maxLength={BIO_MAX + 20}
            value={fields.bio}
            onChange={(e) => set('bio')(e.target.value)}
            hint={bioProblem ?? `${bioLength(fields.bio)} / ${BIO_MAX}`}
            invalid={Boolean(bioProblem)}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {isSaved && (
            <p className="form-note" role="status">
              Saved.
            </p>
          )}
          <Button type="submit" arrow disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </form>
      </main>
    </div>
  )
}

function AvatarEditor() {
  const { session, profile, refreshProfile } = useAuth()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'uploading' | 'removing' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(kind: 'uploading' | 'removing', action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    }
    await refreshProfile()
    setBusy(null)
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = '' // so picking the same file again still fires
    if (!file || !session) return
    const problem = avatarFileError(file)
    if (problem) {
      setError(problem)
      return
    }
    void run('uploading', () => changeAvatar(session.user.id, file))
  }

  const hasAvatar = Boolean(profile?.avatar_path)
  return (
    <section className="avatar-editor" aria-label="Profile picture">
      <Avatar profile={profile} size={88} />
      <div className="avatar-editor-body">
        <div className="avatar-editor-actions">
          <Button
            type="button"
            variant="secondary"
            className="button-compact"
            disabled={busy !== null}
            onClick={() => input.current?.click()}
          >
            {busy === 'uploading' ? 'Uploading…' : hasAvatar ? 'Change photo' : 'Upload photo'}
          </Button>
          {hasAvatar && (
            <button
              type="button"
              className="link-button"
              disabled={busy !== null}
              onClick={() => void run('removing', removeAvatar)}
            >
              {busy === 'removing' ? 'Removing…' : 'Remove'}
            </button>
          )}
        </div>
        <p className={`field-hint${error ? ' is-invalid' : ''}`} role={error ? 'alert' : undefined}>
          {error ?? 'JPEG, PNG or WebP. Cropped to a square.'}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept={AVATAR_INPUT_TYPES.join(',')}
        onChange={onPick}
        hidden
      />
    </section>
  )
}
