const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05]

function toJpgName(name: string): string {
  if (/\.jpg$/i.test(name)) return name
  if (/\.[^.]+$/.test(name)) return name.replace(/\.[^.]+$/, '.jpg')
  return `${name}.jpg`
}

function computeTargetDimensions(
  width: number,
  height: number,
  maxDim = 2048,
): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) return { width, height }
  const ratio = Math.min(maxDim / width, maxDim / height)
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

async function compressImage(file: File, maxBytes: number): Promise<File> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const dims = computeTargetDimensions(bitmap.width, bitmap.height)
    const canvas = new OffscreenCanvas(dims.width, dims.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')
    ctx.drawImage(bitmap, 0, 0, dims.width, dims.height)

    const outputName = toJpgName(file.name)
    for (const quality of QUALITY_STEPS) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality })
      if (blob.size <= maxBytes) {
        return new File([blob], outputName, { type: 'image/jpeg' })
      }
    }

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.05 })
    return new File([blob], outputName, { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

const workerSelf = self as unknown as {
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  postMessage(message: unknown): void
}

workerSelf.addEventListener('message', event => {
  const { file, maxBytes } = event.data as { file: File; maxBytes: number }

  void compressImage(file, maxBytes)
    .then(result => workerSelf.postMessage({ file: result }))
    .catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      workerSelf.postMessage({ error: message })
    })
})

export {}
