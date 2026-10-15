import type { ReactNode } from 'react'
import { Logo } from './Logo.tsx'

type Props = {
  eyebrow: string
  title: string
  subtitle: ReactNode
  children: ReactNode
}

/** Split screen from design/sign-in.png: brand panel left, form right. */
export function AuthLayout({ eyebrow, title, subtitle, children }: Props) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <Logo />
        <div className="auth-brand-body">
          <p className="eyebrow">Private connections</p>
          <h1 className="auth-headline">
            Your people.
            <br />
            Your <span className="accent">space.</span>
          </h1>
          <p className="auth-tagline">
            Connect with the people you know. No noise, no followers — just real conversations.
          </p>
        </div>
        <p className="auth-footnote">Conversations stay between you.</p>
      </aside>

      <main className="auth-panel">
        <div className="auth-panel-logo">
          <Logo />
        </div>
        <div className="auth-form">
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="auth-title">{title}</h2>
          <p className="auth-subtitle">{subtitle}</p>
          {children}
        </div>
      </main>
    </div>
  )
}
