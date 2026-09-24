/**
 * Reproduces the user-reported flow: "If Name matches with the Employee & SIM
 * Directory — copy the Number and complete the table at Bill Summary."
 * Everything below must happen automatically on import, before any extraction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ExtractOutcome, ImportedBill, BillRecord } from '../src/shared/types'
import { closeDatabase, getDb, initDatabase } from '../src/main/db'
import { createEmployee } from '../src/main/repositories/employees'
import { applyOutcome, getBill, insertImportedBills, listBillsForPeriod, rematchUnmatchedBills } from '../src/main/repositories/bills'
import { listRecords } from '../src/main/repositories/records'
import { getOrCreatePeriod } from '../src/main/repositories/periods'

let tmp: string

const outcome = (over: Partial<ExtractOutcome> = {}): ExtractOutcome => ({
  status: 'extracted',
  outstanding: 0,
  penalty: 0,
  billAmount: 107700,
  gst: 5385,
  creditsDebits: 0,
  totalPayable: 113100,
  mobileNumber: null,
  mobileCandidates: [],
  serviceNumber: null,
  evidence: {},
  warnings: [],
  error: null,
  ocrUsed: false,
  summaryPage: 1,
  suggestedMonth: 8,
  suggestedYear: 2026,
  textLength: 400,
  ...over
})

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbm-dirflow-'))
  initDatabase(tmp)
})

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('name match -> copy number -> complete the table', () => {
  it('fills Number + Designation on the Bill Summary row at IMPORT time, no extraction needed', () => {
    // directory written in the messy ways real offices use
    createEmployee({ title: 'Mr.', name: 'A K Basu Mullick', designation: 'Sr. General Manager', mobile: '077100802', simCategory: 'Corporate' })
    createEmployee({ title: 'Mrs.', name: 'Dechen Wangmo', designation: 'Accounts Officer', mobile: '77109949', simCategory: 'Personal' })
    createEmployee({ name: 'Boiler SIM', designation: 'Departmental SIM', mobile: '77110011', simCategory: 'Departmental' })
    createEmployee({ name: 'Chandra Prasad', designation: 'Line Supervisor', mobile: '77120033', simCategory: 'Personal' })
    createEmployee({ name: 'Avinash Kumar Das', designation: 'Manager Admin', mobile: '77144455', simCategory: 'Personal' })

    const period = getOrCreatePeriod(6, 2027, null)
    const names = [
      '01. Mr. A K. Basu Mullick.pdf', // initials with dots
      '02. Mrs. Dechen Wangmo .pdf', // stray space before .pdf
      '06. Boiler SIM.pdf', // departmental SIM, no title
      '07. Mr. Chandra Prasad.pdf',
      '05. Mr. Avinash Kumar Das (Admin).pdf', // suffix noise in filename
      '09. Nobody Here.pdf' // genuinely absent from the directory
    ]
    const files = names.map((fileName) => ({ fileName, originalPath: path.join(tmp, fileName), storedPath: path.join(tmp, fileName) }))
    for (const f of files) fs.writeFileSync(f.originalPath, '%PDF-1.4 dummy')

    const { inserted } = insertImportedBills(period.id, files)
    expect(inserted.length).toBe(6)

    // 1) the import tab's MOBILE NUMBER column is the DIRECTORY number, right away
    const bills = listBillsForPeriod(period.id)
    const billFor = (prefix: string): ImportedBill => bills.find((b) => b.originalFilename.startsWith(prefix))!
    expect(billFor('01.').mobileNumber).toBe('077100802')
    expect(billFor('02.').mobileNumber).toBe('77109949')
    expect(billFor('06.').mobileNumber).toBe('77110011')
    expect(billFor('07.').mobileNumber).toBe('77120033')
    expect(billFor('05.').mobileNumber).toBe('77144455')
    expect(billFor('09.').mobileNumber).toBeNull()

    // 2) the Bill Summary table is COMPLETE (title/username/designation/number)
    //    even though nothing has been extracted yet
    const recs = listRecords(period.id)
    expect(recs.length).toBe(6)
    const recFor = (prefix: string): BillRecord =>
      recs.find((r) => (r.bill?.originalFilename ?? '').startsWith(prefix))!
    expect(recFor('01.').designation).toBe('Sr. General Manager')
    expect(recFor('01.').mobileNumber).toBe('077100802')
    expect(recFor('01.').employeeId).not.toBeNull()
    expect(recFor('06.').username).toBe('Boiler SIM')
    expect(recFor('06.').designation).toBe('Departmental SIM')
    expect(recFor('05.').designation).toBe('Manager Admin') // "(Admin)" suffix noise tolerated
    expect(recFor('09.').mobileNumber).toBeNull()
    expect(recFor('09.').employeeId).toBeNull()
  })

  it('extraction keeps the directory number and completes the amounts', () => {
    const period = getOrCreatePeriod(6, 2027, null)
    const bill = listBillsForPeriod(period.id).find((b) => b.originalFilename.startsWith('07.'))!
    applyOutcome(bill.id, outcome({ mobileNumber: null }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    const rec = listRecords(period.id).find((r) => r.billId === bill.id)!
    expect(rec.mobileNumber).toBe('77120033') // directory value survived re-evaluation
    expect(rec.designation).toBe('Line Supervisor')
    expect(rec.basicAmount).toBe(107700)
    expect(rec.totalAmount).toBe(113100)
    expect(rec.extractionStatus).toBe('extracted') // a PDF without any number is NOT a review reason anymore
  })

  it('upgraded databases: legacy Service-Number review flags clear via re-match', () => {
    // simulate a row extracted by the OLD build: no number, legacy warnings, needs_review
    const period = getOrCreatePeriod(6, 2027, null)
    const bill = listBillsForPeriod(period.id).find((b) => b.originalFilename.startsWith('02.'))!
    const legacy = [
      'No Service Number found on page 1 under "Bill Summary" — enter or confirm the mobile number on review.',
      'No mobile number was extracted from the PDF — the Number column stays empty until it is entered on review.'
    ]
    getDb()
      .prepare(`UPDATE imported_bills SET extraction_status='needs_review', mobile_number=NULL, warnings=? WHERE id=?`)
      .run(JSON.stringify(legacy), bill.id)

    const res = rematchUnmatchedBills(period.id)
    expect(res.promoted).toBeGreaterThanOrEqual(1)
    const after = getBill(bill.id)!
    expect(after.mobileNumber).toBe('77109949') // copied from the directory
    expect(after.extractionStatus).toBe('extracted') // stale reason scrubbed, nothing left to review
  })
})
