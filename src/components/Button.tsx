import type { ButtonHTMLAttributes } from 'react'

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary'
  /** Shows the trailing chevron from the design. */
  arrow?: boolean
}

export function Button({ variant = 'primary', arrow = false, children, className, ...rest }: Props) {
  return (
    <button className={`button button-${variant}${className ? ` ${className}` : ''}`} {...rest}>
      <span>{children}</span>
      {arrow && (
        <svg className="button-arrow" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
