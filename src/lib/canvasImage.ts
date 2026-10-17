// Reading and re-encoding images in the browser, shared by avatars and
// message images. Drawing onto a canvas and encoding that writes a new file,
// which drops the original's metadata (EXIF): on phone photos that can
// include the GPS position where the picture was taken.

/** Decodes the picked file. createImageBitmap applies the EXIF rotation, so phone photos stay upright. */
export function readImage(file: Blob): Promise<ImageBitmap> {
  return createImageBitmap(file).catch(() => {
    throw new Error("That file couldn't be read as an image.")
  })
}

export function newCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error("Your browser couldn't process the image.")
  context.imageSmoothingQuality = 'high'
  return { canvas, context }
}

/** WebP, or JPEG where the browser can't encode WebP. */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  const encode = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85))
  // Browsers that can't encode WebP hand back a PNG instead; use JPEG then.
  const webp = await encode('image/webp')
  const blob = webp?.type === 'image/webp' ? webp : await encode('image/jpeg')
  if (!blob) throw new Error("Your browser couldn't process the image.")
  return blob
}

/** The file extension the storage policies expect for an encoded image. */
export function extensionFor(type: string): 'webp' | 'jpg' {
  return type === 'image/webp' ? 'webp' : 'jpg'
}
