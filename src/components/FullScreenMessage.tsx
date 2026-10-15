import { Logo } from './Logo.tsx'

type Props = {
  title: string
  detail?: string
  action?: { label: string; onClick: () => void }
}

export function FullScreenMessage({ title, detail, action }: Props) {
  return (
    <main className="fullscreen">
      <Logo />
      <p className="fullscreen-title" role="status">
        {title}
      </p>
      {detail && <p className="fullscreen-detail">{detail}</p>}
      {action && (
        <button className="link-button" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </main>
  )
}
