import { useState, type FormEvent } from 'react'
import { deleteAccount } from '../lib/account.ts'
import { Button } from './Button.tsx'
import { Field } from './Field.tsx'

/**
 * "Delete account" at the bottom of the settings page. Asks for the password,
 * so a session left signed in on someone else's device can't do it.
 */
export function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!password) return
    setBusy(true)
    setError(null)
    try {
      await deleteAccount(password) // signs out; the route guard takes it from there
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete your account.")
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <section className="danger-zone" aria-label="Delete account">
        <button type="button" className="link-button quiet-link" onClick={() => setOpen(true)}>
          Delete account
        </button>
      </section>
    )
  }
  return (
    <section className="danger-zone" aria-label="Delete account">
      <form className="confirm-box" onSubmit={onSubmit}>
        <p>
          This deletes your account, profile and friendships for good. The people you talked to keep your messages and
          images, shown as from “Deleted user”. It can’t be undone.
        </p>
        <Field
          label="Your password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <div className="relation-actions">
          <Button type="submit" className="button-compact" disabled={busy || !password}>
            {busy ? 'Deleting…' : 'Delete my account'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="button-compact"
            disabled={busy}
            onClick={() => {
              setOpen(false)
              setPassword('')
              setError(null)
            }}
          >
            Cancel
          </Button>
        </div>
        {error && (
          <p className="relation-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
