import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'

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

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
  hint?: ReactNode
  invalid?: boolean
}

/** Multi-line version of Field, styled the same. */
export function TextAreaField({ label, hint, invalid = false, ...textarea }: TextAreaProps) {
  const id = useId()
  const hintId = `${id}-hint`
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className={`field-control is-multiline${invalid ? ' is-invalid' : ''}`}>
        <textarea
          id={id}
          className="field-input"
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          {...textarea}
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
