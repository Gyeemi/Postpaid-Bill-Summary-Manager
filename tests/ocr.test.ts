/**
 * OCR pipeline test: renders a bill page as an image inside a PDF (a true
 * "scan" — no text layer), then runs the production extraction path which
 * must rasterise the page and recognise the amounts locally.
 */
import { afterAll, beforeAll, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PDFDocument } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'

const require_ = createRequire(import.meta.url)
const workerPath = require_.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')
const tessdataDir = path.resolve(__dirname, '../resources/tessdata')

let tmp: string
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbm-ocr-'))
})
afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

function renderBillImage(): Buffer {
  // a clean 200dpi-style synthetic scan
  const W = 1240
  const H = 1754
  const canvas = createCanvas(W, H)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = '#111111'
  ctx.font = 'bold 34px sans-serif'
  ctx.fillText('WIRELESS POSTPAID BILL — AUGUST 2026', 80, 120)
  ctx.font = '30px sans-serif'
  ctx.fillText('Subscriber: Mr. Akash Prajapati', 80, 200)
  ctx.fillText('Mobile No: 77106873', 80, 250)
  ctx.font = 'bold 32px sans-serif'
  ctx.fillText('Bill Summary', 80, 300)
  ctx.font = '30px sans-serif'
  ctx.fillText('Service Number    Service Type    Amount (Nu.)', 80, 330)
  ctx.fillText('77106873          Rental          300.00', 80, 360)
  ctx.font = 'bold 32px sans-serif'
  ctx.fillText('Account Summary', 80, 420)
  ctx.font = '30px sans-serif'
  const lines = [
    'Outstanding -0.78',
    'Penalty 0.00',
    'Bill Amount 1,077.00',
    'GST (5%) 53.85',
    'Credits / Debits 0.00',
    'Total Payable 1,131.00'
  ]
  lines.forEach((l, i) => ctx.fillText(l, 120, 480 + i * 52))
  return canvas.toBuffer('image/png') as unknown as Buffer
}

it('extracts an Account Summary from a scanned (image-only) PDF via local OCR', async () => {
  const { extractBillPdf } = await import('../src/main/pdf/extract')
  const doc = await PDFDocument.create()
  const png = await doc.embedPng(renderBillImage())
  const page = doc.addPage([595, 842])
  page.drawImage(png, { x: 0, y: 0, width: 595, height: 842 })
  const file = path.join(tmp, 'Scanned Bill.pdf')
  fs.writeFileSync(file, await doc.save())

  const out = await extractBillPdf({
    filePath: file,
    pdfjsWorkerPath: workerPath,
    tessdataDir: fs.existsSync(path.join(tessdataDir, 'eng.traineddata')) ? tessdataDir : null,
    allowOcr: true
  })

  expect(out.ocrUsed, 'OCR should have been attempted').toBe(true)
  expect(out.status === 'extracted' || out.status === 'needs_review').toBe(true)
  // core amounts must come back through OCR (allowing single-digit misreads,
  // but the totals have to be parsed and stay coherent)
  expect(out.totalPayable).not.toBeNull()
  expect(out.billAmount).not.toBeNull()
  if (out.status === 'extracted') {
    expect(out.billAmount).toBe(107700)
    expect(out.gst).toBe(5385)
    expect(out.totalPayable).toBe(113100)
    expect(out.mobileNumber).toBe('77106873')
  } else {
    // OCR saw the section; anything less than 100 % clean text goes to review, never silently accepted
    expect(String(out.warnings.join(' ')) + String(out.error)).toMatch(/Account Summary|GST|differ|Service Number/i)
  }
}, 180000)
