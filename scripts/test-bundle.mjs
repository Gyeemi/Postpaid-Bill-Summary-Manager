// Verifies the BUILT production worker bundle (out/main/extractor-worker.js):
// it is spawned exactly like the packaged app spawns it, fed a real PDF, and
// must return correct extracted amounts. Run after `npm run build`.
import { Worker } from 'node:worker_threads'
import { existsSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { PDFDocument, StandardFonts } from 'pdf-lib'

const root = process.cwd()
const workerScript = path.join(root, 'out', 'main', 'extractor-worker.js')
if (!existsSync(workerScript)) {
  console.error('[test-bundle] out/main/extractor-worker.js missing — run "npm run build" first.')
  process.exit(1)
}
const pdfjsWorker = path.join(root, 'resources', 'pdfjs', 'pdf.worker.min.mjs')
if (!existsSync(pdfjsWorker)) {
  console.error('[test-bundle] resources/pdfjs/pdf.worker.min.mjs missing — run "npm run build:resources".')
  process.exit(1)
}

const tmp = fs_mkdtemp()
function fs_mkdtemp() {
  const d = path.join(os.tmpdir(), `pbm-bundle-${Date.now()}`)
  mkdirSync(d, { recursive: true })
  return d
}

async function makePdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  const lines = [
    'BHUTAN TELECOM — WIRELESS POSTPAID BILL',
    'Mobile No: 77106873',
    '',
    'Account Summary',
    'Outstanding -0.78',
    'Penalty 0.00',
    'Bill Amount 1,077.00',
    'GST (5%) 53.85',
    'Credits / Debits 0.00',
    'Total Payable 1,131.00',
    'Payment History',
    'Paid 1,131.00 on 05 Aug 2026'
  ]
  let y = 780
  for (const l of lines) {
    page.drawText(l, { x: 50, y, size: 10.5, font })
    y -= 17
  }
  const file = path.join(tmp, 'Mr. Akash Prajapati.pdf')
  writeFileSync(file, await doc.save())
  return file
}

const file = await makePdf()
const worker = new Worker(workerScript, {
  workerData: { pdfjsWorkerPath: pdfjsWorker, tessdataDir: null }
})

const fail = (msg) => {
  console.error('[test-bundle] FAIL:', msg)
  try {
    worker.terminate()
  } catch {
    /* ignore */
  }
  process.exit(1)
}

const timer = setTimeout(() => fail('timeout waiting for worker result'), 60000)

worker.on('message', async (msg) => {
  if (msg.type !== 'ready') return
  worker.postMessage({ type: 'job', job: { billId: 42, filePath: file } })
})
worker.on('error', (e) => fail('worker error: ' + e.message))
worker.on('message', async (msg) => {
  if (msg.type !== 'result') return
  clearTimeout(timer)
  const o = msg.outcome
  if (!o) return fail('no outcome returned')
  const checks = [
    ['status', o.status, 'extracted'],
    ['billAmount', o.billAmount, 107700],
    ['gst', o.gst, 5385],
    ['totalPayable', o.totalPayable, 113100],
    ['outstanding', o.outstanding, -78],
    ['mobileNumber', o.mobileNumber, '77106873'],
    ['summaryPage', o.summaryPage, 1]
  ]
  for (const [name, got, want] of checks) {
    if (got !== want) return fail(`${name}: expected ${want}, got ${got}`)
  }
  console.log('[test-bundle] built extractor worker bundle produced correct results ✓')
  await worker.terminate()
  process.exit(0)
})
