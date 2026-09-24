// Downloads the small (fast) English OCR language data into resources/tessdata so
// that the packaged app can run OCR fully offline. Safe to run repeatedly.
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { get } from 'node:https'

const outDir = path.resolve(process.cwd(), 'resources', 'tessdata')
const outFile = path.join(outDir, 'eng.traineddata')

const SOURCES = [
  'https://github.com/tesseract-ocr/tessdata_fast/raw/master/eng.traineddata',
  'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/master/eng.traineddata'
]

function download(url, dest, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location &&
        redirectsLeft > 0
      ) {
        res.resume()
        return download(res.headers.location, dest, redirectsLeft - 1).then(resolve, reject)
      }
      if (res.statusCode !== 200) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`))
      }
      const ws = createWriteStream(dest)
      res.pipe(ws)
      ws.on('finish', () => ws.close(() => resolve()))
      ws.on('error', reject)
    }).on('error', reject)
  })
}

async function main() {
  mkdirSync(outDir, { recursive: true })
  if (existsSync(outFile) && statSync(outFile).size > 1_000_000) {
    console.log('[tessdata] eng.traineddata already present, skipping download.')
    return
  }
  let lastErr
  for (const url of SOURCES) {
    try {
      console.log(`[tessdata] downloading ${url} ...`)
      await download(url, outFile)
      const size = statSync(outFile).size
      if (size < 1_000_000) throw new Error(`file too small (${size} bytes)`)
      console.log(`[tessdata] saved eng.traineddata (${(size / 1048576).toFixed(1)} MB)`)
      return
    } catch (err) {
      lastErr = err
    }
  }
  console.warn(
    '[tessdata] WARNING: could not download eng.traineddata (' +
      (lastErr && lastErr.message) +
      '). Scanned-PDF OCR will download it on first use (requires internet once).'
  )
}

main().catch((err) => {
  console.warn('[tessdata] non-fatal:', err.message)
})
