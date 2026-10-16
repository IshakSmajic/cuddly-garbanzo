import { useState, type ReactNode } from 'react'
import { Button } from './Button.tsx'

type Props = {
  /** The quiet link that opens the confirmation. */
  label: string
  /** What will happen, shown before anything is done. */
  explanation: ReactNode
  confirmLabel: string
  busyLabel: string
  cancelLabel: string
  action: () => Promise<void>
}

/** A link that asks before doing something hard to undo (block, unfriend). */
export function ConfirmAction({ label, explanation, confirmLabel, busyLabel, cancelLabel, action }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    try {
      await action()
      // On success the parent usually swaps this control out; reset anyway.
      setConfirming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Please try again.')
    }
    setBusy(false)
  }

  if (!confirming) {
    return (
      <button type="button" className="link-button quiet-link" onClick={() => setConfirming(true)}>
        {label}
      </button>
    )
  }
  return (
    <div className="confirm-box" role="group" aria-label={label}>
      <p>{explanation}</p>
      <div className="relation-actions">
        <Button className="button-compact" disabled={busy} onClick={() => void run()}>
          {busy ? busyLabel : confirmLabel}
        </Button>
        <Button variant="secondary" className="button-compact" disabled={busy} onClick={() => setConfirming(false)}>
          {cancelLabel}
        </Button>
      </div>
      {error && (
        <p className="relation-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
