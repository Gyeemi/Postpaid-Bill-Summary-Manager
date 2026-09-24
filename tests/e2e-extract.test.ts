/**
 * True end-to-end tests: generate real PDFs with pdf-lib (text placed on
 * random lines/pages) and run the production extraction pipeline
 * (pdf.js -> line reconstruction -> Account Summary parser).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { extractBillPdf } from '../src/main/pdf/extract'

const require_ = createRequire(import.meta.url)
const workerPath = require_.resolve('pdfjs-dist/legacy/build/pdf.worker.min.mjs')

let tmp: string
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbm-e2e-'))
})
afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

async function makePdf(fileName: string, pages: string[][]): Promise<string> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (const lines of pages) {
    const page = doc.addPage([595, 842]) // A4 portrait
    let y = 800
    for (const line of lines) {
      page.drawText(line, { x: 48, y, size: 10.5, font, color: rgb(0, 0, 0) })
      y -= 16
    }
  }
  const file = path.join(tmp, fileName)
  fs.writeFileSync(file, await doc.save())
  return file
}

const run = (file: string) =>
  extractBillPdf({ filePath: file, pdfjsWorkerPath: workerPath, tessdataDir: null, allowOcr: false })

describe('end-to-end extraction from real PDFs', () => {
  it('extracts a canonical page-1 bill with exact amounts', async () => {
    const file = await makePdf('Mr. Akash Prajapati.pdf', [
      [
        'Wireless Postpaid Bill - August 2026',
        'Subscriber: Mr. Akash Prajapati',
        'Mobile No: 77106873',
        'Billing Period: 01 Aug 2026 to 31 Aug 2026',
        'Bill Summary',
        'Service Number     Service Type    Amount (Nu.)',
        '77106873           Rental          300.00',
        'Account Summary',
        'Outstanding -0.78',
        'Penalty 0.00',
        'Bill Amount 1,077.00',
        'GST (5%) 53.85',
        'Credits / Debits 0.00',
        'Total Payable 1,131.00',
        'Payment History',
        'Cash 05 Aug 2026 99,999.00'
      ]
    ])
    const out = await run(file)
    expect(out.status).toBe('extracted')
    expect(out.summaryPage).toBe(1)
    expect(out.billAmount).toBe(107700)
    expect(out.gst).toBe(5385)
    expect(out.totalPayable).toBe(113100)
    expect(out.outstanding).toBe(-78)
    expect(out.penalty).toBe(0)
    expect(out.creditsDebits).toBe(0)
    expect(out.mobileNumber).toBe('77106873')
    expect(out.suggestedMonth).toBe(8)
    expect(out.suggestedYear).toBe(2026)
  }, 40000)

  it('finds the Account Summary on page 2, not page 1, and skips decoys', async () => {
    const file = await makePdf('Mrs. Dechen Wangmo.pdf', [
      [
        'USAGE SUMMARY',
        'Bill Summary',
        'Service Number     Service Type    Amount (Nu.)',
        '77109949           Voice           120.00',
        'Voice minutes used 512',
        'Value Added Services amount 2,499.00',
        'Total amount under review 3,999.00'
      ],
      [
        'ACCOUNT SUMMARY',
        'Outstanding Dues as on 01 Aug 2026: -12.34',
        'Penalty 20.00',
        'Bill Amount 911.39',
        'GST (5%) 45.57',
        'Credits / Debits -35.96',
        'Total Payable 928.66',
        'OTHER DETAILS',
        'Call Rental Charges 1,111.11'
      ]
    ])
    const out = await run(file)
    expect(out.status).toBe('extracted')
    expect(out.summaryPage).toBe(2)
    expect(out.outstanding).toBe(-1234)
    expect(out.penalty).toBe(2000)
    expect(out.billAmount).toBe(91139)
    expect(out.gst).toBe(4557)
    expect(out.creditsDebits).toBe(-3596)
    expect(out.totalPayable).toBe(92866)
  }, 40000)

  it('flags a mismatch for review without altering values', async () => {
    const file = await makePdf('Mismatch.pdf', [
      ['Account Summary', 'Bill Amount 1,000.00', 'GST (5%) 50.00', 'Total Payable 1,100.00']
    ])
    const out = await run(file)
    expect(out.status).toBe('needs_review')
    expect(out.warnings.join(' ')).toMatch(/Basic \+ GST differs/)
    expect(out.billAmount).toBe(100000) // unchanged, not "fixed"
  }, 40000)

  it('marks bills without the section as failed', async () => {
    const file = await makePdf('NoSection.pdf', [['Thank you for your payment', 'Receipt 42', 'Date 09 Sep 2026']])
    const out = await run(file)
    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/Account Summary/)
  }, 40000)

  it('rejects corrupted and non-pdf files with a clear message', async () => {
    const bad = path.join(tmp, 'corrupt.pdf')
    fs.writeFileSync(bad, 'this is not a pdf at all')
    const out = await run(bad)
    expect(out.status).toBe('failed')
    expect(out.error).toMatch(/not a valid PDF/i)
  }, 40000)

  it('handles two account summaries in one document (postpaid + landline)', async () => {
    const file = await makePdf('Both.pdf', [
      [
        'Bill Summary',
        'Service Number     Service Type    Amount (Nu.)',
        '77118695           Data            800.00',
        'Account Summary',
        'GSM - Postpaid',
        'Bill Amount 800.00',
        'GST (5%) 40.00',
        'Total Payable 840.00'
      ],
      ['Account Summary', 'Fixed Line', 'Bill Amount 200.00', 'GST 10.00', 'Total Payable 210.00', 'Payment History', 'Paid 210.00']
    ])
    const out = await run(file)
    expect(out.status).toBe('extracted')
    // one of the two consistent summaries wins; must never mix numbers across them
    expect([80000, 20000]).toContain(out.billAmount)
    if (out.billAmount === 80000) expect(out.totalPayable).toBe(84000)
    else expect(out.totalPayable).toBe(21000)
  }, 40000)

  it('uses the Service Number under the page-1 Bill Summary as the source of truth', async () => {
    const file = await makePdf('TashiCell.pdf', [
      [
        'Tashi InfoComm Private Limited',
        'Alternate Mobile Number for SMS bill : 77100802',
        'Account Code: 6.5381',
        'Bill No : 127700000001349194',
        'Bill Summary',
        'Service Number     Service Type    Description                 Amount (Nu.)',
        '77999002           Rental          Normal Package_Rental       300.00',
        'Account Summary',
        'Outstanding 0.00',
        'Penalty 0.00',
        'Bill Amount 1,000.00',
        'GST (5%) 50.00',
        'Credits / Debits 0.00',
        'Total Payable 1,050.00'
      ]
    ])
    const out = await run(file)
    expect(out.status).toBe('extracted')
    expect(out.serviceNumber).toBe('77999002')
    expect(out.mobileNumber).toBe('77999002')
    expect(out.mobileSource).toBe('service-number')
    expect(out.mobileCandidates[0]).toBe('77999002') // first candidate, ahead of decoys
  }, 40000)

  it('keeps a label-fallback number only as a hint — never a review trigger (directory owns the number)', async () => {
    const file = await makePdf('NoServiceNumber.pdf', [
      [
        'Mobile No: 77106873',
        'Account Summary',
        'Outstanding 0.00',
        'Penalty 0.00',
        'Bill Amount 1,000.00',
        'GST (5%) 50.00',
        'Credits / Debits 0.00',
        'Total Payable 1,050.00'
      ]
    ])
    const out = await run(file)
    expect(out.status).toBe('extracted') // amounts are fine; the number's fate is decided by the directory
    expect(out.warnings.join(' ')).toMatch(/kept only as a hint/)
    expect(out.mobileNumber).toBe('77106873') // recorded for the reviewer, not trusted as the number
    expect(out.mobileSource).toBe('label-fallback')
    expect(out.serviceNumber).toBeNull()
  }, 40000)

  it('reads the printed Account Summary block line-for-line (GST(5%) glued label, colon separators)', async () => {
    const file = await makePdf('06. Ms. Sonam Lhamo.pdf', [
      [
        'TASHI CELL - WIRELESS POSTPAID BILL',
        'Bill Date : 01/09/2026   |   Account Code: 6.5381',
        'Bill Summary',
        'Service Number     Service Type    Amount (Nu.)',
        '77102255           Rental          261.29',
        'Account Summary',
        'Outstanding : 1,625.06',
        'Penalty : 0.00',
        'Bill Amount : 261.29',
        'GST(5%) : 13.06',
        'Credits / Debits: 0.00',
        'Total Payable : 1,900.00',
        'Total Payable Amount : 1900.00'
      ]
    ])
    const out = await run(file)
    expect(out.status).toBe('extracted')
    expect(out.outstanding).toBe(162506)
    expect(out.penalty).toBe(0)
    expect(out.billAmount).toBe(26129)
    expect(out.gst).toBe(1306)
    expect(out.creditsDebits).toBe(0)
    expect(out.totalPayable).toBe(190000)
    expect(out.serviceNumber).toBe('77102255')
    // 261.29 + 13.06 + 1,625.06 = 1,899.41 vs printed 1,900.00 -> bill-side
    // rounding (Nu. 0.59): explained, advisory only, must NOT flip to review
    expect(out.status).toBe('extracted')
    expect(out.warnings.join(' ')).toMatch(/explained by Outstanding/i)
  }, 40000)

  it('captures a Service Number printed inline after its label', async () => {
    const file = await makePdf('InlineSN.pdf', [
      [
        'Bill Summary',
        'Service Number: 77100802     Service Type    Amount (Nu.)',
        'Account Summary',
        'Outstanding 0.00',
        'Penalty 0.00',
        'Bill Amount 1,000.00',
        'GST (5%) 50.00',
        'Credits / Debits 0.00',
        'Total Payable 1,050.00'
      ]
    ])
    const out = await run(file)
    expect(out.serviceNumber).toBe('77100802')
    expect(out.mobileNumber).toBe('77100802')
    expect(out.status).toBe('extracted')
  }, 40000)
})
