import { bubbleImageWidth } from '../lib/images.ts'
import { useImageUrl } from '../lib/imageUrls.ts'

type Props = {
  path: string
  width: number
  height: number
  onOpen: (url: string) => void
}

/**
 * An image in a chat bubble. Its box has the image's shape from the start
 * (width and height are stored with the attachment), so the conversation
 * doesn't jump when the file arrives.
 */
export function MessageImage({ path, width, height, onOpen }: Props) {
  const { url, failed, retry } = useImageUrl(path)
  const style = { width: bubbleImageWidth(width, height), aspectRatio: `${width} / ${height}` }

  if (failed) {
    return (
      <button type="button" className="bubble-image is-failed" style={style} onClick={retry}>
        Couldn't load the image. Tap to retry
      </button>
    )
  }
  return (
    <button
      type="button"
      className="bubble-image"
      style={style}
      aria-label="Open image"
      disabled={!url}
      onClick={() => url && onOpen(url)}
    >
      {url && <img src={url} alt="" width={width} height={height} onError={retry} />}
    </button>
  )
}

/** The space an image takes before its details arrive (a live message, just now). */
export function MessageImagePlaceholder() {
  return <span className="bubble-image is-loading" aria-label="Loading image" />
}
