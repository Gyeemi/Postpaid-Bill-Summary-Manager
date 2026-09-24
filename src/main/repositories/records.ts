import { assignSrs, sortByFileSr } from '../../shared/subscriber'
import { getDb } from '../db'
import type { BillRecord, ReportSnapshotRow, ReportTotals, RecordUpdate } from '../../shared/types'
import { mobilesMatch } from '../../shared/subscriber'
import { findEmployeeByMobile, getEmployee } from './employees'

interface RecRow {
  sr_from_filename: number | null
  id: number
  bill_id: number
  employee_id: number | null
  period_id: number
  title: string | null
  username: string | null
  designation: string | null
  mobile_number: string | null
  basic_amount: number | null
  gst: number | null
  outstanding: number | null
  penalty: number | null
  credits_debits: number | null
  total_amount: number | null
  deduction: number
  include_in_report: number
  reviewed: number
  extraction_status: BillRecord['extractionStatus']
  original_filename: string
  stored_path: string | null
  original_path: string | null
  subscriber_name: string | null
  detected_title: string | null
  detected_name: string | null
  bill_mobile: string | null
  o_outstanding: number | null
  o_penalty: number | null
  o_bill_amount: number | null
  o_gst: number | null
  o_credits: number | null
  o_total: number | null
  error_message: string | null
  warnings: string | null
  field_evidence: string | null
  mobile_candidates: string | null
  ocr_used: number
  summary_page: number | null
  suggested_month: number | null
  suggested_year: number | null
  is_manual: number
  processed_at: string | null
  created_at: string
}

const SELECT = `
  SELECT r.*,
         b.extraction_status,
         b.original_filename, b.stored_path, b.original_path, b.subscriber_name,
         b.detected_title, b.detected_name, b.sr_from_filename, b.mobile_number AS bill_mobile,
         b.outstanding AS o_outstanding, b.penalty AS o_penalty, b.bill_amount AS o_bill_amount,
         b.gst AS o_gst, b.credits_debits AS o_credits, b.total_payable AS o_total,
         b.error_message, b.warnings, b.field_evidence, b.mobile_candidates,
         b.ocr_used, b.summary_page, b.suggested_month, b.suggested_year,
         b.is_manual, b.processed_at, b.created_at
  FROM bill_summary_records r
  JOIN imported_bills b ON b.id = r.bill_id`

function map(r: RecRow): BillRecord {
  // the printed Total Payable is authoritative; the mismatch is what the Account
  // Summary components (bill + GST + outstanding + penalty + credits/debits) sum to
  const components =
    (r.basic_amount ?? 0) + (r.gst ?? 0) + (r.outstanding ?? 0) + (r.penalty ?? 0) + (r.credits_debits ?? 0)
  const mismatch = r.basic_amount !== null && r.total_amount !== null ? components - r.total_amount : null
  return {
    id: r.id,
    billId: r.bill_id,
    employeeId: r.employee_id,
    periodId: r.period_id,
    title: r.title,
    username: r.username,
    designation: r.designation,
    mobileNumber: r.mobile_number,
    srFromFilename: r.sr_from_filename ?? null,
    basicAmount: r.basic_amount,
    gst: r.gst,
    outstanding: r.outstanding ?? null,
    penalty: r.penalty ?? null,
    creditsDebits: r.credits_debits ?? null,
    totalAmount: r.total_amount,
    deduction: r.deduction,
    includeInReport: !!r.include_in_report,
    reviewed: !!r.reviewed,
    extractionStatus: r.extraction_status,
    isManual: !!r.is_manual,
    mismatchChh: r.basic_amount !== null && r.total_amount !== null ? mismatch : null,
    warnings: r.warnings ? (JSON.parse(r.warnings) as string[]) : [],
    bill: {
      id: r.bill_id,
      periodId: r.period_id,
      originalFilename: r.original_filename,
      storedPath: r.stored_path,
      originalPath: r.original_path,
      subscriberName: r.subscriber_name,
      detectedTitle: r.detected_title,
      detectedName: r.detected_name,
      srFromFilename: r.sr_from_filename ?? null,
      mobileNumber: r.bill_mobile,
      outstanding: r.o_outstanding,
      penalty: r.o_penalty,
      billAmount: r.o_bill_amount,
      gst: r.o_gst,
      creditsDebits: r.o_credits,
      totalPayable: r.o_total,
      extractionStatus: r.extraction_status,
      errorMessage: r.error_message,
      fieldEvidence: r.field_evidence ? (JSON.parse(r.field_evidence) as Record<string, string>) : null,
      mobileCandidates: r.mobile_candidates ? (JSON.parse(r.mobile_candidates) as string[]) : [],
      ocrUsed: !!r.ocr_used,
      summaryPage: r.summary_page,
      suggestedMonth: r.suggested_month,
      suggestedYear: r.suggested_year,
      isManual: !!r.is_manual,
      duplicateOf: null,
      processedAt: r.processed_at,
      createdAt: r.created_at
    }
  }
}

export function listRecords(periodId: number): BillRecord[] {
  const rows = getDb().prepare(`${SELECT} WHERE r.period_id = ? ORDER BY r.id`).all(periodId) as RecRow[]
  return rows.map(map)
}

export function getRecord(id: number): BillRecord | null {
  const r = getDb().prepare(`${SELECT} WHERE r.id = ?`).get(id) as RecRow | undefined
  return r ? map(r) : null
}

export function updateRecord(id: number, patch: RecordUpdate & { markReviewed?: boolean }): BillRecord | null {
  const db = getDb()
  const cur = db.prepare(`SELECT * FROM bill_summary_records WHERE id = ?`).get(id) as
    | {
        id: number
        bill_id: number
        period_id: number
        mobile_number: string | null
        employee_id: number | null
      }
    | undefined
  if (!cur) throw new Error('Record not found')
  db.transaction(() => {
    const set: string[] = []
    const vals: (string | number | null)[] = []
    const put = (col: string, v: string | number | null | undefined): void => {
      if (v === undefined) return
      set.push(`${col} = ?`)
      vals.push(v === null ? null : v)
    }
    put('employee_id', patch.employeeId)
    put('title', patch.title)
    put('username', patch.username)
    put('designation', patch.designation)
    put('mobile_number', patch.mobileNumber)
    put('basic_amount', patch.basicAmount)
    put('gst', patch.gst)
    put('outstanding', patch.outstanding)
    put('penalty', patch.penalty)
    put('credits_debits', patch.creditsDebits)
    put('total_amount', patch.totalAmount)
    put('deduction', patch.deduction)
    if (patch.includeInReport !== undefined) {
      set.push('include_in_report = ?')
      vals.push(patch.includeInReport ? 1 : 0)
    }
    if (patch.markReviewed) {
      set.push('reviewed = 1')
    }
    if (set.length === 0) return
    set.push(`updated_at = datetime('now')`)

    // changing the mobile number re-attempts directory matching (unless a manual employee link was given)
    if (patch.mobileNumber !== undefined && !mobilesMatch(patch.mobileNumber, cur.mobile_number) && patch.employeeId === undefined) {
      const emp = findEmployeeByMobile(patch.mobileNumber)
      if (emp) {
        set.push('employee_id = ?')
        vals.push(emp.id)
        set.push('title = ?')
        vals.push(emp.title)
        set.push('username = ?')
        vals.push(emp.name)
        set.push('designation = ?')
        vals.push(emp.designation)
        set.push('mobile_number = ?')
        vals.push(emp.mobile)
      }
    }

    // an explicit directory selection is authoritative: copy its details onto the
    // summary row AND the bill, so Import tab + report + exports all agree
    if (patch.employeeId) {
      const sel = getEmployee(patch.employeeId)
      if (sel) {
        for (const [col, v] of [
          ['title', sel.title],
          ['username', sel.name],
          ['designation', sel.designation],
          ['mobile_number', sel.mobile]
        ] as [string, string | null][]) {
          set.push(`${col} = ?`)
          vals.push(v)
        }
        const billRow = db.prepare(`SELECT field_evidence FROM imported_bills WHERE id=?`).get(cur.bill_id) as { field_evidence: string | null } | undefined
        let ev: Record<string, unknown> = {}
        try {
          ev = JSON.parse(billRow?.field_evidence ?? '{}')
        } catch {
          /* fresh evidence object */
        }
        ev.mobileSource = 'directory-manual'
        ev.directoryNumber = sel.mobile ?? null
        db.prepare(`UPDATE imported_bills SET mobile_number=?, field_evidence=? WHERE id=?`).run(sel.mobile ?? null, JSON.stringify(ev), cur.bill_id)
      }
    }

    vals.push(id)
    db.prepare(`UPDATE bill_summary_records SET ${set.join(', ')} WHERE id = ?`).run(...(vals as (string | number | null)[]))

    if (patch.markReviewed) {
      db.prepare(`UPDATE imported_bills SET extraction_status='extracted' WHERE id=? AND extraction_status='needs_review'`).run(cur.bill_id)
    }
  })()
  return getRecord(id)
}

/** clear the "reviewed" flag when amounts are edited so review is forced again if invalid */
export function noteAmountEdited(id: number): void {
  getDb().prepare(`UPDATE bill_summary_records SET updated_at = datetime('now') WHERE id = ?`).run(id)
}

export function computeTotals(periodId: number, includedOnly = true): ReportTotals {
  const where = includedOnly ? 'AND r.include_in_report = 1' : ''
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n,
              COALESCE(SUM(r.basic_amount),0) AS basic,
              COALESCE(SUM(r.gst),0) AS gst,
              COALESCE(SUM(r.outstanding),0) AS outstanding,
              COALESCE(SUM(r.penalty),0) AS penalty,
              COALESCE(SUM(r.credits_debits),0) AS credits,
              COALESCE(SUM(r.total_amount),0) AS total,
              COALESCE(SUM(r.deduction),0) AS deduction
       FROM bill_summary_records r WHERE r.period_id = ? ${where}`
    )
    .get(periodId) as { n: number; basic: number; gst: number; outstanding: number; penalty: number; credits: number; total: number; deduction: number }
  return {
    count: row.n,
    basic: row.basic,
    gst: row.gst,
    outstanding: row.outstanding,
    penalty: row.penalty,
    credits: row.credits,
    total: row.total,
    deduction: row.deduction
  }
}

export function includedRowsForSnapshot(periodId: number): ReportSnapshotRow[] {
  const rows = sortByFileSr(listRecords(periodId).filter((r) => r.includeInReport))
  const srs = assignSrs(rows)
  return rows.map((r, i) => ({
    sr: srs[i],
    title: r.title,
    username: r.username,
    designation: r.designation,
    mobile: r.mobileNumber,
    basic: r.basicAmount,
    gst: r.gst,
    outstanding: r.outstanding,
    penalty: r.penalty,
    credits: r.creditsDebits,
    total: r.totalAmount,
    deduction: r.deduction
  }))
}

/** rows that block finalization: failed extractions or unreviewed issues that are included */
export function unreviewedIssues(periodId: number): { billId: number; fileName: string; reason: string }[] {
  const recs = listRecords(periodId).filter((r) => r.includeInReport)
  const issues: { billId: number; fileName: string; reason: string }[] = []
  for (const r of recs) {
    if (!r.bill) continue
    if (r.extractionStatus === 'failed') {
      issues.push({ billId: r.billId, fileName: r.bill.originalFilename, reason: 'Extraction failed and no values were entered' })
      continue
    }
    if (r.basicAmount === null || r.totalAmount === null) {
      issues.push({ billId: r.billId, fileName: r.bill.originalFilename, reason: 'Missing Basic Amount or Total Amount' })
      continue
    }
    if (r.extractionStatus === 'needs_review' && !r.reviewed) {
      issues.push({ billId: r.billId, fileName: r.bill.originalFilename, reason: 'Extraction flagged for review — review or correct it first' })
    }
  }
  return issues
}

export function deleteRecord(recordId: number): void {
  const db = getDb()
  const cur = db.prepare(`SELECT bill_id FROM bill_summary_records WHERE id = ?`).get(recordId) as { bill_id: number } | undefined
  if (!cur) return
  // removing a row from the report removes the whole bill entry
  db.prepare(`DELETE FROM imported_bills WHERE id = ?`).run(cur.bill_id)
}
