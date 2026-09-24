// Copies pdf.js' pre-built legacy worker (Node-safe) into resources/pdfjs so the
// packaged app can load it from a plain file path. No bundling required.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require_ = createRequire(import.meta.url)
const outDir = path.resolve(process.cwd(), 'resources', 'pdfjs')

function main() {
  mkdirSync(outDir, { recursive: true })
  const candidates = [
    'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
    'pdfjs-dist/build/pdf.worker.min.mjs',
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    'pdfjs-dist/build/pdf.worker.mjs'
  ]
  for (const c of candidates) {
    try {
      const src = require_.resolve(c)
      copyFileSync(src, path.join(outDir, 'pdf.worker.min.mjs'))
      console.log('[build-pdfjs-worker] copied', c, '-> resources/pdfjs/pdf.worker.min.mjs')
      return
    } catch {
      /* try next */
    }
  }
  console.error('[build-pdfjs-worker] could not find a pdfjs worker in node_modules; run npm install first.')
  process.exit(1)
}

if (!existsSync(path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist'))) {
  console.error('[build-pdfjs-worker] pdfjs-dist is not installed yet.')
  process.exit(1)
}
main()
