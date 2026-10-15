import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  /** Shown under the input; turns red when `invalid`. */
  hint?: ReactNode
  invalid?: boolean
  prefix?: string
}

export function Field({ label, hint, invalid = false, prefix, ...input }: Props) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={`field-control${invalid ? ' is-invalid' : ''}`}>
        {prefix && (
          <span className="field-prefix" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          className="field-input"
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          {...input}
        />
      </div>
      {hint && (
        <p id={hintId} className={`field-hint${invalid ? ' is-invalid' : ''}`}>
          {hint}
        </p>
      )}
    </div>
  )
}
