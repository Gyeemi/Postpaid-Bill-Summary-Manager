/**
 * Locates runtime resources (pdf.js worker, OCR language data) in both the
 * unpackaged development layout and the installed application layout.
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { ensureDir } from './fsx'

let cachedWorker: string | null | undefined
let cachedTessdata: string | null | undefined

export function resolvePdfjsWorkerPath(): string | null {
  if (cachedWorker !== undefined) return cachedWorker
  const candidates: string[] = []
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'pdfjs', 'pdf.worker.min.mjs'))
    candidates.push(path.join(path.dirname(app.getAppPath()), 'pdfjs', 'pdf.worker.min.mjs'))
  }
  candidates.push(path.join(app.getAppPath(), 'resources', 'pdfjs', 'pdf.worker.min.mjs'))
  candidates.push(path.join(app.getAppPath(), 'resources', 'pdfjs', 'pdf.worker.mjs'))
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      cachedWorker = c
      return c
    }
  }
  // dev fallback: the raw file from node_modules
  try {
    const req = createRequire(path.join(app.getAppPath(), 'index.js'))
    const p = req.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
    if (fs.existsSync(p)) {
      cachedWorker = p
      return p
    }
  } catch {
    /* not found */
  }
  cachedWorker = null
  return null
}

/**
 * Returns a directory containing eng.traineddata (or null if OCR data is not
 * available offline; tesseract.js can then fetch it once on demand).
 */
export function resolveTessdataDir(): string | null {
  if (cachedTessdata !== undefined) return cachedTessdata
  const userData = app.getPath('userData')
  const target = path.join(userData, 'tessdata')
  const targetFile = path.join(target, 'eng.traineddata')
  if (fs.existsSync(targetFile)) {
    cachedTessdata = target
    return cachedTessdata
  }
  const sources = app.isPackaged
    ? [path.join(process.resourcesPath, 'tessdata', 'eng.traineddata')]
    : [
        path.join(app.getAppPath(), 'resources', 'tessdata', 'eng.traineddata'),
        path.join(process.resourcesPath, 'tessdata', 'eng.traineddata')
      ]
  for (const src of sources) {
    if (src && fs.existsSync(src)) {
      try {
        ensureDir(target)
        fs.copyFileSync(src, targetFile)
        cachedTessdata = target
        return cachedTessdata
      } catch {
        /* fall through */
      }
    }
  }
  cachedTessdata = null
  return null
}

export function extractorWorkerScript(): string {
  // built next to the main entry: out/main/extractor-worker.js (dev and prod)
  return path.join(__dirname, 'extractor-worker.js')
}
