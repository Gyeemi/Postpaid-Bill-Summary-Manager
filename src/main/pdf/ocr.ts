/**
 * Local OCR helpers for scanned bills. Rasterises a pdf.js page with
 * @napi-rs/canvas and recognises it with tesseract.js. Everything stays on the
 * user's machine; no page images or text are ever uploaded anywhere.
 */

export async function renderPageToPng(page: any, maxPixels = 12_000_000): Promise<Buffer | null> {
  const { createCanvas } = (await import('@napi-rs/canvas')) as typeof import('@napi-rs/canvas')
  const base = page.getViewport({ scale: 1 })
  // target roughly 200 dpi, but never exceed the pixel budget
  let scale = Math.min(2.1, (maxPixels / (base.width * base.height)) ** 0.5, 6)
  if (scale < 0.8) return null
  const viewport = page.getViewport({ scale })
  const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height))
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, viewport, background: '#ffffff', intent: 'print' }).promise
  const buf: Buffer = canvas.toBuffer('image/png') as unknown as Buffer
  return buf
}

let cachedWorker: any = null
let cachedWorkerDir: string | null = null

export async function getOcrWorker(tessdataDir: string | null): Promise<any> {
  if (cachedWorker && cachedWorkerDir === tessdataDir) return cachedWorker
  const { createWorker } = await import('tesseract.js')
  const options: Record<string, unknown> = {
    gzip: false,
    // tesseract.js looks for `<lang>.traineddata` when gzip:false
    ...(tessdataDir ? { langPath: tessdataDir, cachePath: tessdataDir } : {})
  }
  cachedWorker = await createWorker('eng', 1, options)
  cachedWorkerDir = tessdataDir
  return cachedWorker
}

export async function recognizePng(png: Buffer, tessdataDir: string | null): Promise<string> {
  const worker = await getOcrWorker(tessdataDir)
  const { data } = await worker.recognize(png)
  const text: string = data?.text ?? ''
  // normalise the most common OCR confusions inside amount blocks
  return text.replace(/[•°º]/g, '.').replace(/[Oo](?=\d*\d)/g, (m, off, s) => (/[\d,]{2}/.test(String(s).slice(Math.max(0, off - 4))) ? '0' : m))
}

export async function disposeOcrWorker(): Promise<void> {
  if (cachedWorker) {
    try {
      await cachedWorker.terminate()
    } catch {
      /* ignore */
    }
    cachedWorker = null
  }
}
