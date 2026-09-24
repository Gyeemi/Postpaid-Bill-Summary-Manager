/**
 * Professional Excel (.xlsx) export of the Bill Summary Report.
 * Amount cells hold real numbers with "#,##0.00" formatting so the sheet stays
 * fully usable for payroll processing; the Deduction column is left free for
 * editing.
 */
import path from 'node:path'
import type { ReportSnapshot } from '../../shared/types'
import { ensureDir } from '../util/fsx'

export async function writeReportXlsx(snapshot: ReportSnapshot, savePath: string): Promise<string> {
  const ExcelJS = (await import('exceljs')).default ?? (await import('exceljs'))
  const wb = new ExcelJS.Workbook()
  wb.creator = snapshot.orgName || 'Postpaid Bill Summary Manager'
  wb.created = new Date()
  const ws = wb.addWorksheet('Bill Summary', {
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, paperSize: 9 },
    views: [{ state: 'frozen', ySplit: 5 }]
  })

  const cols: Partial<import('exceljs').Column>[] = [
    { key: 'sr', width: 7 },
    { key: 'title', width: 8 },
    { key: 'username', width: 26 },
    { key: 'designation', width: 26 },
    { key: 'mobile', width: 13 },
    { key: 'outstanding', width: 13 },
    { key: 'penalty', width: 11 },
    { key: 'basic', width: 14 },
    { key: 'gst', width: 13 },
    { key: 'credits', width: 14 },
    { key: 'total', width: 15 },
    { key: 'deduction', width: 14 }
  ]
  const HEADERS = [
    'Sr. No.', 'Title', 'Username', 'Designation', 'Number',
    'Outstanding', 'Penalty', 'Bill Amount', `GST @ ${snapshot.gstRate ?? 5}%`,
    'Credits / Debits', 'Total Payable', 'Deduction'
  ]
  ws.columns = cols

  // ---- title block (rows 1-3), header on row 5 ---------------------------
  ws.getRow(1).height = 24
  ws.getRow(2).height = 18
  const orgName = snapshot.orgName || 'Organization'
  ws.mergeCells('A1:L1')
  ws.getCell('A1').value = orgName
  ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF16324F' } }
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' }
  ws.mergeCells('A2:L2')
  const payablePart = snapshot.payableBeforeFormatted ? `  •  Payable Before: ${snapshot.payableBeforeFormatted}` : (snapshot.prepLabel ? `  •  Prepared In: ${snapshot.prepLabel}` : '')
  ws.getCell('A2').value = `${snapshot.reportTitle}  •  Billing Month: ${snapshot.billingLabel ?? snapshot.periodLabel}${payablePart}`
  ws.getCell('A2').font = { bold: true, size: 12 }
  ws.getCell('A2').alignment = { horizontal: 'center' }
  ws.mergeCells('A3:L3')
  ws.getCell('A3').value =
    `Report date: ${snapshot.reportDate}      Generated: ${snapshot.generatedAt}      All amounts in ${snapshot.currency}`
  ws.getCell('A3').font = { size: 9, color: { argb: 'FF55627A' } }
  ws.getCell('A3').alignment = { horizontal: 'center' }

  const headerRow = ws.getRow(5)
  headerRow.values = HEADERS
  headerRow.height = 20
  headerRow.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10.5 }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF16324F' } }
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
    c.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    }
  })

  const moneyFmt = `#,##0.00`
  const toNum = (v: number | null): number | null => (v === null ? null : Math.round(v) / 100)

  snapshot.rows.forEach((r, i) => {
    const row = ws.addRow({
      sr: r.sr ?? String(i + 1).padStart(2, '0'),
      title: r.title ?? '',
      username: r.username ?? '',
      designation: r.designation ?? '',
      mobile: r.mobile ?? '',
      outstanding: toNum(r.outstanding ?? null),
      penalty: toNum(r.penalty ?? null),
      basic: toNum(r.basic),
      gst: toNum(r.gst),
      credits: toNum(r.credits ?? null),
      total: toNum(r.total),
      deduction: toNum(r.deduction) ?? 0
    })
    row.height = 16
    row.eachCell({ includeEmpty: true }, (c, colIdx) => {
      c.border = {
        top: { style: 'hair', color: { argb: 'FF9FB0C4' } },
        left: { style: 'thin', color: { argb: 'FF9FB0C4' } },
        bottom: { style: 'hair', color: { argb: 'FF9FB0C4' } },
        right: { style: 'thin', color: { argb: 'FF9FB0C4' } }
      }
      if (colIdx >= 6 && colIdx <= 12) {
        c.numFmt = moneyFmt
        c.alignment = { horizontal: 'right' }
      } else if (colIdx <= 2) {
        c.alignment = { horizontal: 'center' }
      }
    })
    row.getCell(5).alignment = { horizontal: 'center' }
    row.getCell(12).font = { color: { argb: 'FF0B5394' } }
    if (i % 2 === 1) {
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F7FB' } }
      })
    }
  })

  const t = snapshot.totals
  const grand = ws.addRow({
    sr: '',
    title: '',
    username: '',
    designation: '',
    mobile: `GRAND TOTAL (${t.count})`,
    outstanding: toNum(t.outstanding ?? 0),
    penalty: toNum(t.penalty ?? 0),
    basic: toNum(t.basic),
    gst: toNum(t.gst),
    credits: toNum(t.credits ?? 0),
    total: toNum(t.total),
    deduction: toNum(t.deduction)
  })
  grand.height = 19
  grand.eachCell({ includeEmpty: true }, (c, colIdx) => {
    c.font = { bold: true, size: 11 }
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE7F5' } }
    c.border = { top: { style: 'double', color: { argb: 'FF16324F' } }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
    if (colIdx >= 6 && colIdx <= 12) {
      c.numFmt = (snapshot.currency || 'Nu.') === 'Nu.' ? `"Nu. " ${moneyFmt}` : moneyFmt
      c.alignment = { horizontal: 'right' }
    }
  })
  grand.getCell(5).alignment = { horizontal: 'right' }

  if (snapshot.footerText && snapshot.footerText.trim()) {
    const noteRow = ws.addRow([])
    ws.mergeCells(noteRow.number, 1, noteRow.number, 12)
    noteRow.getCell(1).value = snapshot.footerText.trim()
    noteRow.getCell(1).font = { size: 8.5, italic: true, color: { argb: 'FF55627A' } }
    noteRow.height = 20
  }

  const sigRow = ws.addRow(['', '', 'Prepared By', '', '', 'Checked By', '', '', 'Approved By', '', '', ''])
  sigRow.height = 28
  ;[3, 6, 9].forEach((c) => {
    sigRow.getCell(c).font = { size: 9, color: { argb: 'FF55627A' } }
    sigRow.getCell(c).border = { top: { style: 'thin' } }
  })

  ensureDir(path.dirname(savePath))
  await wb.xlsx.writeFile(savePath)
  return savePath
}

export function defaultXlsxName(snapshot: ReportSnapshot): string {
  const base = (snapshot.reportTitle || 'Bill Summary').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
  return `${base || 'Bill Summary'}.xlsx`
}


