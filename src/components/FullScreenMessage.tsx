import { Logo } from './Logo.tsx'

type Props = {
  title: string
  detail?: string
  actions?: { label: string; onClick: () => void }[]
}

export function FullScreenMessage({ title, detail, actions = [] }: Props) {
  return (
    <main className="fullscreen">
      <Logo />
      <p className="fullscreen-title" role="status">
        {title}
      </p>
      {detail && <p className="fullscreen-detail">{detail}</p>}
      {actions.length > 0 && (
        <div className="fullscreen-actions">
          {actions.map((action) => (
            <button key={action.label} className="link-button" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      )}
    </main>
  )
}
