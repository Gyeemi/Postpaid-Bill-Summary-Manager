/**
 * Export tests: the Excel writer must produce a workbook with exact numeric
 * cells (not text), and the report HTML (shared by print preview and PDF
 * export) must contain the complete table, grand totals and signature block.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import type { ReportSnapshot } from '../src/shared/types'
import { buildReportHtml } from '../src/shared/reportHtml'
import { writeReportXlsx } from '../src/main/exports/xlsx'

let tmp: string
beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pbm-exp-'))
})
afterAll(() => {
  try {
    fs.rmSync(tmp, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

const snapshot: ReportSnapshot = {
  orgName: 'Tashi Post & Telecom',
  orgSub: 'Postpaid Telephone Bill Management',
  orgLogoPath: null,
  gstRate: 5,
  footerText: 'Verify deductions before payroll.',
  currency: 'Nu.',
  reportTitle: 'Postpaid Bill Summary – August 2026',
  periodLabel: 'August 2026',
  billingLabel: 'August 2026',
  prepLabel: 'September 2026',
  payableBefore: '2026-09-30',
  payableBeforeFormatted: '30|09|2026',
  reportDate: '2026-09-01',
  generatedAt: '01 Sep 2026, 10:00',
  rows: [
    { title: 'Mr.', username: 'A K Basu Mullick', designation: 'Sr. General Manager', mobile: '77100802', outstanding: 162506, penalty: 0, basic: 107700, gst: 5385, credits: -59, total: 113100, deduction: 113100 },
    { title: 'Mrs.', username: 'Dechen Wangmo', designation: 'Sale EXC', mobile: '77109949', outstanding: -1234, penalty: 2000, basic: 91139, gst: 4557, credits: -1762, total: 95700, deduction: 0 },
    { title: null, username: 'TBL', designation: 'Data Card', mobile: '77118695', outstanding: 0, penalty: 0, basic: 80000, gst: 4000, credits: 0, total: 84000, deduction: 0 },
    { title: 'Mr.', username: 'Akash Prajapati', designation: null, mobile: '77106873', outstanding: null, penalty: null, basic: 80000, gst: 4000, credits: null, total: 84000, deduction: 42000 }
  ],
  totals: { basic: 358839, gst: 17942, total: 376800, deduction: 155100, count: 4, outstanding: 151172, penalty: 2000, credits: -1821 }
}

describe('Excel export', () => {
  it('writes real numbers, headers, sequence and grand totals', async () => {
    const file = path.join(tmp, 'report.xlsx')
    await writeReportXlsx(snapshot, file)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(file)
    const ws = wb.getWorksheet('Bill Summary')!
    expect(ws).toBeTruthy()

    // header row 5 with bold text
    const header = ws.getRow(5)
    expect(String(header.getCell(1).value)).toBe('Sr. No.')
    expect(String(header.getCell(6).value)).toBe('Outstanding')
    expect(String(header.getCell(7).value)).toBe('Penalty')
    expect(String(header.getCell(8).value)).toBe('Bill Amount')
    expect(String(header.getCell(10).value)).toBe('Credits / Debits')
    expect(String(header.getCell(11).value)).toBe('Total Payable')
    expect(String(header.getCell(12).value)).toBe('Deduction')
    expect(header.getCell(6).font?.bold).toBe(true)

    // subtitle carries billing month + payable before date
    expect(String(ws.getCell('A2').value)).toContain('Billing Month: August 2026')
    expect(String(ws.getCell('A2').value)).toContain('Payable Before: 30|09|2026')

    // first data row: exact numeric values (NOT strings), two-decimal format
    const r6 = ws.getRow(6)
    expect(String(r6.getCell(1).value)).toBe('01')
    expect(r6.getCell(3).value).toBe('A K Basu Mullick')
    expect(r6.getCell(6).value).toBeCloseTo(1625.06, 6) // outstanding
    expect(r6.getCell(7).value).toBeCloseTo(0.0, 6) // penalty
    expect(r6.getCell(8).value).toBeCloseTo(1077.0, 6) // bill amount
    expect(r6.getCell(9).value).toBeCloseTo(53.85, 6) // gst
    expect(r6.getCell(10).value).toBeCloseTo(-0.59, 6) // credits / debits
    expect(r6.getCell(11).value).toBeCloseTo(1131.0, 6) // total payable
    expect(r6.getCell(12).value).toBeCloseTo(1131.0, 6) // deduction editable number
    expect(String(r6.getCell(8).numFmt)).toContain('#,##0.00')
    // unextracted components stay blank, not zero
    const r9 = ws.getRow(9)
    expect(r9.getCell(6).value ?? null).toBe(null)
    expect(r9.getCell(11).value).toBeCloseTo(840.0, 6)

    // grand total row after 4 data rows
    const grand = ws.getRow(10)
    expect(String(grand.getCell(5).value)).toContain('GRAND TOTAL')
    expect(grand.getCell(6).value).toBeCloseTo(1511.72, 6)
    expect(grand.getCell(8).value).toBeCloseTo(3588.39, 6)
    expect(grand.getCell(9).value).toBeCloseTo(179.42, 6)
    expect(grand.getCell(10).value).toBeCloseTo(-18.21, 6)
    expect(grand.getCell(11).value).toBeCloseTo(3768.0, 6)
    expect(grand.getCell(12).value).toBeCloseTo(1551.0, 6)

    // grand total payable equals the sum of the Total Payable column
    let sum = 0
    for (let i = 6; i <= 9; i++) sum += Number(ws.getRow(i).getCell(11).value)
    expect(Math.round(sum * 100)).toBe(376800)

    expect(fs.statSync(file).size).toBeGreaterThan(5000)
  })
})

describe('Report HTML (print / PDF source)', () => {
  it('contains organization, table, grand totals and signature block', () => {
    const html = buildReportHtml(snapshot, { interactive: false })
    expect(html).toContain('Tashi Post &amp; Telecom')
    expect(html).toContain('Postpaid Bill Summary – August 2026')
    expect(html).toContain('Billing Month: <b>August 2026</b>')
    expect(html).toContain('Payable Before: <b>30|09|2026</b>')
    expect(html).toContain('August 2026')
    expect(html).toContain('Prepared By')
    expect(html).toContain('Checked By')
    expect(html).toContain('Approved By')
    expect(html).toContain('GRAND TOTAL (4 bills)')
    expect(html).toContain('Nu. 3,768.00')
    expect(html).toContain('Nu. 1,551.00')
    expect(html).toContain('Nu. 179.42')
    expect(html).toContain('GST @ 5%')
    expect(html).toContain('Outstanding (Nu.)')
    expect(html).toContain('Credits / Debits (Nu.)')
    expect(html).toContain('Total Payable (Nu.)')
    expect(html).toContain('Total Outstanding')
    expect(html).toContain('1,625.06')
    expect(html).toContain('Nu. 1,511.72')
    expect(html).toContain('-0.59')
    expect(html).toContain('Verify deductions before payroll.')
    // repeated header on every printed page
    expect(html).toContain('display: table-header-group')
    expect(html).toContain('@page')
    // blank titles allowed (row 3)
    expect(html).toMatch(/03[\s\S]*?TBL[\s\S]*?77118695[\s\S]*?800\.00[\s\S]*?40\.00[\s\S]*?840\.00/)
  })
})
