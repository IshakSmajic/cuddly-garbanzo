import { useEffect, useRef } from 'react'

/**
 * A full-screen view of one image. A modal <dialog> gives Esc to close,
 * keeps keyboard focus inside and restores it afterwards, without extra code.
 */
export function ImageViewer({ url, onClose }: { url: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)

  // No cleanup: closing would fire the close event (and onClose) when React
  // re-runs the effect in development, and an unmounted dialog leaves the top
  // layer by itself.
  useEffect(() => {
    const el = dialog.current
    if (el && !el.open) el.showModal()
  }, [])

  return (
    <dialog
      ref={dialog}
      className="image-viewer"
      aria-label="Image"
      onClose={onClose}
      // A click on the backdrop (the dialog itself, not the image) closes it.
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <img src={url} alt="" />
      <button type="button" className="image-viewer-close" aria-label="Close" onClick={onClose}>
        ×
      </button>
    </dialog>
  )
}
