/**
 * Integration tests for the persistence layer + report math, using a real
 * (temporary) SQLite database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeDatabase, getDb, initDatabase } from '../src/main/db'
import { createEmployee, findEmployeeByMobile, listEmployees, updateEmployee } from '../src/main/repositories/employees'
import { findPeriod, getOrCreatePeriod, periodLabel } from '../src/main/repositories/periods'
import { applyOutcome, createManualBill, duplicateBillsIntoPeriod, getBill, insertImportedBills, recoverInterruptedProcessing, rematchUnmatchedBills } from '../src/main/repositories/bills'
import { computeTotals, includedRowsForSnapshot, listRecords, unreviewedIssues, updateRecord } from '../src/main/repositories/records'
import { finalizeReport, getReport, listReports } from '../src/main/repositories/reports'
import { getSettings, saveSettings } from '../src/main/repositories/settings'
import type { ExtractOutcome } from '../src/shared/types'

let dir: string
let tmp: string

const outcome = (over: Partial<ExtractOutcome> = {}): ExtractOutcome => ({
  status: 'extracted',
  outstanding: 0,
  penalty: 0,
  billAmount: 107700,
  gst: 5385,
  creditsDebits: 0,
  totalPayable: 113100,
  mobileNumber: '77106873',
  mobileCandidates: ['77106873'],
  evidence: { billAmount: 'Bill Amount 1,077.00' },
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
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbm-test-'))
  dir = tmp
  initDatabase(dir)
})

afterAll(() => {
  closeDatabase()
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe('settings', () => {
  it('has documented defaults and persists changes', () => {
    const s = getSettings()
    expect(s.currency).toBe('Nu.')
    expect(s.gstRatePercent).toBe(5)
    saveSettings({ orgName: 'Test Org', theme: 'dark', gstRatePercent: 5 })
    expect(getSettings().orgName).toBe('Test Org')
    expect(getSettings().theme).toBe('dark')
  })
})

describe('employee directory', () => {
  it('creates, blocks duplicate mobiles and finds by number', () => {
    const e = createEmployee({ title: 'Mr.', name: 'A K Basu Mullick', designation: 'Sr. General Manager', mobile: '77100802', simCategory: 'Corporate' })
    expect(e.id).toBeGreaterThan(0)
    expect(() => createEmployee({ name: 'Someone Else', mobile: '077100802' })).toThrow(/already used/)
    // departmental SIM without personal title works
    const d = createEmployee({ name: 'Boiler SIM', mobile: '77110011', simCategory: 'Departmental' })
    createEmployee({ title: 'Mr.', name: 'Akash Prajapati', designation: 'Assistant Manager', mobile: '77106873', simCategory: 'Corporate' })
    createEmployee({ title: 'Mrs.', name: 'Dechen Wangmo', designation: 'Accounts Officer', mobile: '77109949', simCategory: 'Corporate' })
    expect(d.title).toBeNull()
    expect(findEmployeeByMobile('9177100802')?.name).toBe('A K Basu Mullick')
    expect(listEmployees('boiler').length).toBe(1)
    updateEmployee(d.id, { ...d, isActive: false })
    expect(findEmployeeByMobile('77110011')).toBeNull() // inactive not auto-matched
    updateEmployee(d.id, { ...d, isActive: true })
  })
})

describe('Account Summary breakdown on report rows (v3)', () => {
  it('persists, edits, totals and snapshots Outstanding/Penalty/Credits on the record', () => {
    const period = getOrCreatePeriod(7, 2026, 'Postpaid Bill Summary – July 2026')
    const files = ['Ms. Sonam Lhamo.pdf', 'TBL Data Card.pdf'].map((fileName) => ({
      fileName,
      originalPath: path.join(tmp, fileName),
      storedPath: path.join(tmp, fileName)
    }))
    for (const f of files) fs.writeFileSync(f.originalPath, '%PDF-1.4 dummy')
    const { inserted } = insertImportedBills(period.id, files)
    const [sonam, tbl] = inserted.map((i) => i.billId)

    // the paper block from the user's example: printed total 1,900.00, components 1,899.41
    applyOutcome(sonam, outcome({
      mobileNumber: '077100802', outstanding: 162506, penalty: 0, billAmount: 26129,
      gst: 1306, creditsDebits: -59, totalPayable: 190000
    }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    // a bill that reconciles exactly
    applyOutcome(tbl, outcome({
      mobileNumber: '77106873', outstanding: 500, penalty: 2000, billAmount: 80000,
      gst: 4000, creditsDebits: 0, totalPayable: 86500
    }), { autoCalcGst: true, gstRatePercent: 5, force: true })

    const recs = listRecords(period.id)
    const sRec = recs.find((r) => r.billId === sonam)!
    expect(sRec.outstanding).toBe(162506)
    expect(sRec.penalty).toBe(0)
    expect(sRec.creditsDebits).toBe(-59)
    expect(sRec.basicAmount).toBe(26129)
    expect(sRec.totalAmount).toBe(190000) // printed amount kept verbatim
    expect(sRec.extractionStatus).toBe('extracted')
    // components (26,129 + 1,306 + 162,506 + 0 - 59) - 190,000 = -118
    expect(sRec.mismatchChh).toBe(26129 + 1306 + 162506 + 0 - 59 - 190000)
    const tRec = recs.find((r) => r.billId === tbl)!
    expect(tRec.mismatchChh).toBe(0) // bill + gst + outstanding + penalty reconciles

    // totals across the report
    const tot = computeTotals(period.id)
    expect(tot.outstanding).toBe(162506 + 500)
    expect(tot.penalty).toBe(0 + 2000)
    expect(tot.credits).toBe(-59 + 0)
    expect(tot.total).toBe(190000 + 86500)

    // editing an outstanding re-balances the check
    const edited = updateRecord(sRec.id, { outstanding: 162624 })!
    expect(edited.mismatchChh).toBe(0)

    // snapshot rows carry the breakdown for exports
    const snap = includedRowsForSnapshot(period.id)
    const sRow = snap.find((r) => r.username === 'A K Basu Mullick') ?? snap[0]
    expect(sRow.outstanding).toBe(162624)
    const snapTot = computeTotals(period.id)
    expect(snapTot.outstanding).toBe(162624 + 500)

    // manual entry keeps its breakdown on the row too
    const m = createManualBill({
      periodId: period.id, subscriberName: 'Mr. Manual Test', mobileNumber: null,
      basicAmount: 50000, gst: 2500, totalAmount: 54200, outstanding: 1700, penalty: 0, creditsDebits: 0
    })
    const mRec = listRecords(period.id).find((r) => r.billId === m.billId)!
    expect(mRec.outstanding).toBe(1700)
    expect(mRec.mismatchChh).toBe(0)
  })
})

describe('bill pipeline', () => {
  it('imports rows, extracts, matches directory, warns on mismatch, finalizes totals', () => {
    const period = getOrCreatePeriod(8, 2026, `Postpaid Bill Summary – ${periodLabel(8, 2026)}`)
    const files = ['Mr. Akash Prajapati.pdf', 'Mrs. Dechen Wangmo.pdf', 'A K Basu Mullick.pdf', 'TBL Data Card.pdf'].map((fileName) => ({
      fileName,
      originalPath: path.join(tmp, fileName),
      storedPath: path.join(tmp, fileName)
    }))
    for (const f of files) fs.writeFileSync(f.originalPath, '%PDF-1.4 dummy')
    const { inserted, skipped } = insertImportedBills(period.id, files)
    expect(inserted.length).toBe(4)
    expect(skipped.length).toBe(0)
    // duplicate import prevention
    const again = insertImportedBills(period.id, files)
    expect(again.inserted.length).toBe(0)
    expect(again.skipped.length).toBe(4)

    const [akash, dechen, basu, tbl] = inserted.map((i) => i.billId)
    applyOutcome(akash, outcome({ mobileNumber: '77106873', billAmount: 80000, gst: 4000, totalPayable: 84000 }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    // missing gst -> auto calc path + review-able
    applyOutcome(dechen, outcome({ mobileNumber: '77109949', billAmount: 91139, gst: null, totalPayable: 95700, status: 'needs_review', warnings: ['GST amount was not found next to its label.'] }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    // matches the directory by number
    applyOutcome(basu, outcome({ mobileNumber: '077100802', billAmount: 107700, gst: 5385, totalPayable: 113100 }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    // failed extraction must block finalization
    applyOutcome(tbl, outcome({ status: 'failed', billAmount: null, totalPayable: null, error: 'No "Account Summary" section was detected in this PDF.', mobileNumber: null, coreMissing: [] } as never), { autoCalcGst: true, gstRatePercent: 5, force: true })

    let recs = listRecords(period.id)
    expect(recs.length).toBe(4)
    const dechenRec = recs.find((r) => r.username?.includes('Dechen'))!
    expect(dechenRec.gst).toBe(4557) // auto-calculated 45.57
    const basuRec = recs.find((r) => r.employeeId !== null && r.username === 'A K Basu Mullick')!
    expect(basuRec.designation).toBe('Sr. General Manager')
    expect(basuRec.username).toBe('A K Basu Mullick')

    let issues = unreviewedIssues(period.id)
    expect(issues.some((i) => i.reason.includes('Extraction failed'))).toBe(true)

    const fin = finalizeReport(period.id, 'Postpaid Bill Summary – August 2026', '2026-09-01')
    expect(fin.ok).toBe(false) // blocked while the failed bill is included

    // manual entry for the failed one, then uncheck nothing — totals must update
    updateRecord(recs.find((r) => r.username?.includes('TBL'))!.id, { includeInReport: false })
    const manual = createManualBill({
      periodId: period.id,
      subscriberName: 'TBL',
      originalFilename: 'TBL Data Card (manual entry)',
      mobileNumber: '77118695',
      basicAmount: 80000,
      gst: 4000,
      totalAmount: 84000
    })
    expect(manual.billId).toBeGreaterThan(0)

    // deduction editing is reflected dynamically
    const afterManual = listRecords(period.id)
    const manualRec = afterManual.find((r) => r.mobileNumber === '77118695')!
    updateRecord(manualRec.id, { deduction: 5000 })
    const totals = computeTotals(period.id, true)
    const expected = 84000 + 95700 + 113100 + 84000
    expect(totals.total).toBe(expected) // grand total payable = sum of total payable
    expect(totals.deduction).toBe(5000)

    // gst missing on Dechen auto-calculated: 91139 * 5% = 4557; total kept 95700 (basic+gst=95696 -> mismatch warning, must not alter total)
    expect(dechenRec.mismatchChh).toBe(91139 + 4557 - 95700)

    const fin2 = finalizeReport(period.id, 'Postpaid Bill Summary – August 2026', '2026-09-01')
    expect(fin2.ok).toBe(true)
    const hist = listReports('August')
    expect(hist.length).toBe(1)
    const rep = getReport(hist[0].id)!
    // snapshot holds the 4 included rows; the excluded failed TBL bill is not part of it
    expect(rep.snapshot.rows.length).toBe(4)
    expect(rep.snapshot.rows.some((r) => r.username === 'TBL')).toBe(true)
    expect(rep.snapshot.totals.total).toBe(expected)
    const rows = includedRowsForSnapshot(period.id)
    expect(rows.length).toBe(4)
  })

  it('recovers interrupted processing on startup', () => {
    const p = findPeriod(8, 2026)!
    const { inserted } = insertImportedBills(p.id, [{ fileName: 'crash.pdf', originalPath: '', storedPath: '' }])
    getDb().prepare(`UPDATE imported_bills SET extraction_status='processing' WHERE id=?`).run(inserted[0].billId)
    expect(recoverInterruptedProcessing()).toBeGreaterThanOrEqual(1)
    const row = getDb().prepare(`SELECT extraction_status FROM imported_bills WHERE id=?`).get(inserted[0].billId) as { extraction_status: string }
    expect(row.extraction_status).toBe('pending')
  })

  it('duplicates a period as a starting point', () => {
    const from = findPeriod(8, 2026)!
    const to = getOrCreatePeriod(9, 2026)
    const n = duplicateBillsIntoPeriod(from.id, to.id)
    expect(n).toBeGreaterThanOrEqual(4)
    const totals = computeTotals(to.id, true)
    expect(totals.count).toBe(n)
  })

  it('keeps monetary columns as integers in the database', () => {
    const kinds = (
      getDb()
        .prepare(`SELECT type FROM pragma_table_info('imported_bills') WHERE name IN ('bill_amount','gst','total_payable')`)
        .all() as { type: string }[]
    ).map((r) => r.type)
    expect(kinds.length).toBe(3)
    for (const k of kinds) expect(k.toUpperCase()).toBe('INTEGER')
  })
})

describe('filename Sr/Title/Username persistence', () => {
  it('stores parsed parts and feeds snapshot rows (row already exists from import)', () => {
    const period = getOrCreatePeriod(3, 2026, null)
    const mk = (fileName: string): { fileName: string; originalPath: string; storedPath: string } => ({
      fileName,
      originalPath: path.join(tmp, fileName),
      storedPath: path.join(tmp, fileName)
    })
    // names deliberately absent from the shared employee directory -> title stays filename-derived
    insertImportedBills(period.id, [mk('03. Pema Topge.pdf'), mk('01. Mr. Sonam Dorji.pdf')])
    const db = getDb()
    const bills = db
      .prepare(`SELECT id, subscriber_name, detected_title, detected_name, sr_from_filename FROM imported_bills WHERE period_id = ? ORDER BY id`)
      .all(period.id) as { id: number; subscriber_name: string; detected_title: string; detected_name: string; sr_from_filename: number }[]
    expect(bills[0]).toMatchObject({ subscriber_name: 'Pema Topge', detected_title: null, detected_name: 'Pema Topge', sr_from_filename: 3 })
    expect(bills[1]).toMatchObject({ subscriber_name: 'Mr. Sonam Dorji', detected_title: 'Mr.', detected_name: 'Sonam Dorji', sr_from_filename: 1 })
    // the summary rows were created at import time; amounts arrive via the extraction step
    for (const b of bills) {
      const rec = db.prepare(`SELECT id FROM bill_summary_records WHERE bill_id = ?`).get(b.id) as { id: number }
      expect(rec).toBeTruthy()
      db.prepare(`UPDATE bill_summary_records SET mobile_number=?, basic_amount=100000, gst=5000, total_amount=105000, reviewed=1 WHERE id=?`).run(
        String(77000000 + b.id),
        rec.id
      )
    }
    const rows = includedRowsForSnapshot(period.id)
    // sorted by filename number: 01 first, then 03
    expect(rows.map((r) => r.sr)).toEqual(['01', '03'])
    expect(rows[0].username).toBe('Sonam Dorji')
    expect(rows[0].title).toBe('Mr.')
    expect(rows[1].title).toBeNull()
  })
})

describe('Directory-first number matching', () => {
  it('resolves the number from the directory by NAME, flags unknown subscribers, and re-matches after the directory grows', () => {
    const period = getOrCreatePeriod(6, 2026, null)
    const fileName = 'Ms. Pema Wangi.pdf'
    const p = path.join(tmp, fileName)
    fs.writeFileSync(p, '%PDF-1.4 dummy')
    const { inserted } = insertImportedBills(period.id, [{ fileName, originalPath: p, storedPath: p }])
    const [pema] = inserted.map((i) => i.billId)

    // unknown subscriber: a number printed in the PDF must NOT fill the column on its own
    applyOutcome(pema, outcome({ mobileNumber: '77888778', serviceNumber: '77888778' }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    let bill = getBill(pema)!
    let rec = listRecords(period.id)[0]
    expect(bill.mobileNumber).toBeNull()
    expect(rec.extractionStatus).toBe('needs_review')
    expect(rec.warnings.join(' ')).toMatch(/No Employee & SIM Directory record matches subscriber/)
    expect((bill.fieldEvidence as Record<string, unknown>)?.['serviceNumberHint']).toBe('77888778') // hint kept for the reviewer

    // directory gains the entry (registered number differs from the PDF's) -> rematch links, fills and clears the review
    createEmployee({ title: 'Ms.', name: 'Pema Wangi', designation: 'Admin Officer', mobile: '77112233', simCategory: 'Personal' })
    const res = rematchUnmatchedBills(period.id)
    expect(res.linked).toBe(1)
    expect(res.promoted).toBe(1)
    bill = getBill(pema)!
    rec = listRecords(period.id)[0]
    expect(bill.mobileNumber).toBe('77112233') // the DIRECTORY's number, not the PDF's
    expect(rec.mobileNumber).toBe('77112233')
    expect(rec.designation).toBe('Admin Officer')
    expect(rec.extractionStatus).toBe('extracted')
    expect((rec.bill?.fieldEvidence as Record<string, unknown>)?.['mobileSource']).toBe('directory-name')
  })

  it('PDF Service Number conflicting with the directory number flags review but keeps the directory value', () => {
    const period = getOrCreatePeriod(5, 2026, null)
    const fileName = 'Mr. Tashi Number.pdf'
    const p = path.join(tmp, fileName)
    fs.writeFileSync(p, '%PDF-1.4 dummy')
    createEmployee({ name: 'Tashi Number', mobile: '77123456', simCategory: 'Personal' })
    const { inserted } = insertImportedBills(period.id, [{ fileName, originalPath: p, storedPath: p }])
    const [tashi] = inserted.map((i) => i.billId)
    applyOutcome(tashi, outcome({ mobileNumber: '99999999', serviceNumber: '99999999' }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    const rec = listRecords(period.id).find((r) => r.billId === tashi)!
    expect(rec.extractionStatus).toBe('needs_review')
    expect(rec.warnings.join(' ')).toMatch(/differs from the Directory number 77123456/)
    expect(getBill(tashi)!.mobileNumber).toBe('77123456') // directory wins outright
  })

  it('manual directory selection on the review sheet copies designation + number and updates the bill', () => {
    const period = getOrCreatePeriod(4, 2026, null)
    const fileName = 'Nobody Known.pdf'
    const p = path.join(tmp, fileName)
    fs.writeFileSync(p, '%PDF-1.4 dummy')
    const { inserted } = insertImportedBills(period.id, [{ fileName, originalPath: p, storedPath: p }])
    const [id] = inserted.map((i) => i.billId)
    applyOutcome(id, outcome({ mobileNumber: null }), { autoCalcGst: true, gstRatePercent: 5, force: true })
    const rec = listRecords(period.id).find((r) => r.billId === id)!
    expect(rec.extractionStatus).toBe('needs_review')
    const akash = findEmployeeByMobile('77106873')!
    const after = updateRecord(rec.id, { employeeId: akash.id, markReviewed: true })!
    expect(after.designation).toBe('Assistant Manager')
    expect(after.username).toBe('Akash Prajapati')
    expect(after.mobileNumber).toBe('77106873')
    expect(after.extractionStatus).toBe('extracted')
    expect(getBill(id)!.mobileNumber).toBe('77106873') // the Import tab shows it too
  })
})
