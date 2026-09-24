import { getDb } from '../db'
import type { ExtractOutcome, ImportedBill } from '../../shared/types'
import { parseSubscriberFilename, mobilesMatch } from '../../shared/subscriber'
import { findEmployeeByMobile, findEmployeeByNameMatch } from './employees'
import { computeGstChh } from '../../shared/money'

interface BillRow {
  id: number
  period_id: number
  original_filename: string
  stored_path: string | null
  original_path: string | null
  subscriber_name: string | null
  sr_from_filename: number | null
  detected_title: string | null
  detected_name: string | null
  mobile_number: string | null
  outstanding: number | null
  penalty: number | null
  bill_amount: number | null
  gst: number | null
  credits_debits: number | null
  total_payable: number | null
  extraction_status: ImportedBill['extractionStatus']
  error_message: string | null
  warnings: string | null
  field_evidence: string | null
  mobile_candidates: string | null
  ocr_used: number
  summary_page: number | null
  suggested_month: number | null
  suggested_year: number | null
  is_manual: number
  duplicate_of: number | null
  processed_at: string | null
  created_at: string
}

function map(r: BillRow): ImportedBill {
  return {
    id: r.id,
    periodId: r.period_id,
    originalFilename: r.original_filename,
    storedPath: r.stored_path,
    originalPath: r.original_path,
    subscriberName: r.subscriber_name,
    detectedTitle: r.detected_title,
    detectedName: r.detected_name,
    srFromFilename: r.sr_from_filename ?? null,
    mobileNumber: r.mobile_number,
    outstanding: r.outstanding,
    penalty: r.penalty,
    billAmount: r.bill_amount,
    gst: r.gst,
    creditsDebits: r.credits_debits,
    totalPayable: r.total_payable,
    extractionStatus: r.extraction_status,
    errorMessage: r.error_message,
    fieldEvidence: r.field_evidence ? (JSON.parse(r.field_evidence) as Record<string, string>) : null,
    mobileCandidates: r.mobile_candidates ? (JSON.parse(r.mobile_candidates) as string[]) : [],
    ocrUsed: !!r.ocr_used,
    summaryPage: r.summary_page,
    suggestedMonth: r.suggested_month,
    suggestedYear: r.suggested_year,
    isManual: !!r.is_manual,
    duplicateOf: r.duplicate_of,
    processedAt: r.processed_at,
    createdAt: r.created_at
  }
}

export function getBill(id: number): ImportedBill | null {
  const r = getDb().prepare(`SELECT * FROM imported_bills WHERE id = ?`).get(id) as BillRow | undefined
  return r ? map(r) : null
}

export function listBillsForPeriod(periodId: number): ImportedBill[] {
  const rows = getDb()
    .prepare(`SELECT * FROM imported_bills WHERE period_id = ? ORDER BY id`)
    .all(periodId) as BillRow[]
  return rows.map(map)
}

/** Insert bill rows for freshly imported PDFs; returns inserted + skipped filenames. */
export function insertImportedBills(
  periodId: number,
  files: { fileName: string; originalPath: string; storedPath: string }[]
): { inserted: { billId: number; fileName: string }[]; skipped: { fileName: string; reason: string }[] } {
  const db = getDb()
  const inserted: { billId: number; fileName: string }[] = []
  const skipped: { fileName: string; reason: string }[] = []
  db.transaction(() => {
    for (const f of files) {
      const dup = db
        .prepare(`SELECT id FROM imported_bills WHERE period_id = ? AND original_filename = ?`)
        .get(periodId, f.fileName) as { id: number } | undefined
      if (dup) {
        skipped.push({ fileName: f.fileName, reason: 'already imported in this billing period' })
        continue
      }
      // "01. Mr. A K Basu Mullick.pdf" -> Sr 1 | Title "Mr." | Name "A K Basu Mullick"
      const parsed = parseSubscriberFilename(f.fileName)
      // Directory-first: the subscriber identified from the filename immediately
      // resolves to the directory's registered mobile number (the extraction run
      // later confirms/overwrites this the same way).
      const nameHit = findEmployeeByNameMatch(parsed.fullName ?? parsed.name)
      const emp = nameHit.employee
      const info = db
        .prepare(
          `INSERT INTO imported_bills (period_id, original_filename, original_path, stored_path, subscriber_name, detected_title, detected_name, sr_from_filename, mobile_number, extraction_status)
           VALUES (?,?,?,?,?,?,?,?,?, 'pending')`
        )
        .run(periodId, f.fileName, f.originalPath, f.storedPath, parsed.fullName, parsed.title, parsed.name, parsed.sr, emp?.mobile ?? null)
      const billId = Number(info.lastInsertRowid)
      // complete the Bill Summary table right away: a name match copies the
      // directory's Title / Name / Designation / Number onto the report row
      // before amounts are ever extracted (applyOutcome later fills those in)
      db.prepare(
        `INSERT INTO bill_summary_records (bill_id, employee_id, period_id, title, username, designation, mobile_number, deduction, include_in_report)
         SELECT ?,?,?,?,?,?,?,0,1
         WHERE NOT EXISTS (SELECT 1 FROM bill_summary_records WHERE bill_id = ?)`
      ).run(billId, emp?.id ?? null, periodId, emp?.title ?? parsed.title, emp?.name ?? parsed.name ?? parsed.fullName, emp?.designation ?? null, emp?.mobile ?? null, billId)
      inserted.push({ billId, fileName: f.fileName })
    }
  })()
  return { inserted, skipped }
}

export function markBillsProcessing(ids: number[]): void {
  const db = getDb()
  const stmt = db.prepare(`UPDATE imported_bills SET extraction_status = 'processing', error_message = NULL WHERE id = ?`)
  db.transaction(() => ids.forEach((id) => stmt.run(id)))()
}

/**
 * Store the outcome of an extraction and (re)build the editable working record.
 * Never touches values on records the user already edited, except when the user
 * explicitly re-ran extraction (force=true).
 */
export function applyOutcome(billId: number, out: ExtractOutcome, opts: { autoCalcGst: boolean; gstRatePercent: number; force: boolean }): void {
  const db = getDb()
  db.transaction(() => {
    let warnings = [...out.warnings]
    let gst = out.gst
    let status = out.status
    if (gst === null && out.billAmount !== null && opts.autoCalcGst) {
      gst = computeGstChh(out.billAmount, opts.gstRatePercent)
      warnings.push(`GST was not found in the PDF; auto-calculated at ${opts.gstRatePercent}% (mark shown for review).`)
      if (status === 'needs_review') status = 'extracted'
    }
    // --- Employee & SIM Directory is the AUTHORITATIVE source of the number.
    // The subscriber is identified from the PDF filename, looked up in the
    // directory by name (falling back to a PDF Service Number -> number hit),
    // and the directory's registered number is what gets stored everywhere.
    const pre = getBill(billId)
    const subscriberLabel = pre?.subscriberName ?? pre?.detectedName ?? 'this subscriber'
    const byName = findEmployeeByNameMatch(pre?.subscriberName ?? pre?.detectedName)
    const byNumber = !byName.employee && byName.candidates.length === 0 && out.mobileNumber ? { employee: findEmployeeByMobile(out.mobileNumber), candidates: [] as never[] } : null
    const emp = byName.employee ?? byNumber?.employee ?? null
    let mobileSource: string = 'none'
    let directoryNumber: string | null = null
    const flagReview = (): void => {
      if (status !== 'failed') status = 'needs_review'
    }
    if (emp) {
      directoryNumber = emp.mobile ?? null
      mobileSource = byName.employee ? 'directory-name' : 'directory-number'
      if (!directoryNumber) {
        flagReview()
        warnings.push(`Directory entry "${emp.name}" was matched but has no mobile number — add the number in the Employee & SIM Directory or enter it on review.`)
      }
      // cross-check: PDF's page-1 Service Number vs the directory's number
      if (out.serviceNumber && directoryNumber && !mobilesMatch(out.serviceNumber, directoryNumber)) {
        flagReview()
        warnings.push(
          `PDF "Service Number" ${out.serviceNumber} differs from the Directory number ${directoryNumber} for ${emp.name} — the Directory value is used; verify this bill belongs to ${emp.name}.`
        )
      }
    } else if (byName.candidates.length > 1) {
      flagReview()
      warnings.push(
        `${byName.candidates.length} directory entries could match "${subscriberLabel}" (${byName.candidates.map((c) => c.name).join(', ')}) — select the right one in the review sheet.`
      )
    } else {
      flagReview()
      warnings.push(
        `No Employee & SIM Directory record matches subscriber "${subscriberLabel}" — add the SIM to the directory (or pick an entry in the review sheet) to fill the Number.`
      )
    }
    db.prepare(
      `UPDATE imported_bills SET
         outstanding=?, penalty=?, bill_amount=?, gst=?, credits_debits=?, total_payable=?,
         mobile_number=?, mobile_candidates=?, field_evidence=?, extraction_status=?, error_message=?,
         warnings=?, ocr_used=?, summary_page=?, suggested_month=?, suggested_year=?, processed_at=datetime('now')
       WHERE id=?`
    ).run(
      out.outstanding,
      out.penalty,
      out.billAmount,
      gst,
      out.creditsDebits,
      out.totalPayable,
      directoryNumber,
      JSON.stringify(out.mobileCandidates ?? []),
      JSON.stringify({
        ...(out.evidence ?? {}),
        mobileSource,
        serviceNumberHint: out.serviceNumber ?? out.mobileNumber ?? null,
        directoryNumber
      }),
      status,
      out.error,
      warnings.length ? JSON.stringify(warnings) : null,
      out.ocrUsed ? 1 : 0,
      out.summaryPage,
      out.suggestedMonth,
      out.suggestedYear,
      billId
    )

    const bill = getBill(billId)!
    const existing = db.prepare(`SELECT * FROM bill_summary_records WHERE bill_id = ?`).get(billId) as
      | { id: number; reviewed: number }
      | undefined

    const alreadyEdited = !!existing && !opts.force
    if (!alreadyEdited) {
      const baseTitle = emp ? emp.title : bill.detectedTitle
      const baseName = emp ? emp.name : bill.detectedName ?? bill.subscriberName
      const mobileDisplay = directoryNumber
      if (existing) {
        db.prepare(
          `UPDATE bill_summary_records SET employee_id=?, title=?, username=?, designation=?, mobile_number=?,
             basic_amount=?, gst=?, outstanding=?, penalty=?, credits_debits=?, total_amount=?, updated_at=datetime('now')
           WHERE id=?`
        ).run(
          emp?.id ?? null,
          baseTitle,
          baseName,
          emp?.designation ?? null,
          mobileDisplay,
          out.billAmount,
          gst,
          out.outstanding,
          out.penalty,
          out.creditsDebits,
          out.totalPayable,
          existing.id
        )
      } else {
        db.prepare(
          `INSERT INTO bill_summary_records (bill_id, employee_id, period_id, title, username, designation, mobile_number, basic_amount, gst, outstanding, penalty, credits_debits, total_amount, deduction, include_in_report)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,1)`
        ).run(billId, emp?.id ?? null, bill.periodId, baseTitle, baseName, emp?.designation ?? null, mobileDisplay, out.billAmount, gst, out.outstanding, out.penalty, out.creditsDebits, out.totalPayable)
      }
    }

    // duplicate mobile number within the same period?
    if (bill.mobileNumber) {
      const others = db
        .prepare(
          `SELECT id, mobile_number FROM imported_bills WHERE period_id = ? AND id != ? AND mobile_number IS NOT NULL`
        )
        .all(bill.periodId, billId) as { id: number; mobile_number: string }[]
      const clash = others.find((o) => mobilesMatch(o.mobile_number, bill.mobileNumber))
      if (clash && !warnings.some((w) => w.includes('duplicate mobile'))) {
        const row = db.prepare(`SELECT warnings FROM imported_bills WHERE id=?`).get(billId) as { warnings: string | null } | undefined
        const list = JSON.parse(row?.warnings ?? '[]') as string[]
        list.push(`Duplicate mobile number: the same number is used by bill #${clash.id} in this billing period.`)
        db.prepare(`UPDATE imported_bills SET warnings=?, extraction_status='needs_review' WHERE id=?`).run(JSON.stringify(list), billId)
      }
    }
  })()
}

export function setBillStatus(billId: number, status: ImportedBill['extractionStatus'], error?: string | null): void {
  getDb()
    .prepare(`UPDATE imported_bills SET extraction_status = ?, error_message = ? WHERE id = ?`)
    .run(status, error ?? null, billId)
}

/**
 * Re-run the filename -> Employee & SIM Directory name matching over every
 * non-manual bill that is still unmatched (no directory link / no number).
 * Clears now-obsolete "directory record" review warnings and promotes records
 * whose only issue was the missing match. Called after directory edits and by
 * the "Re-match directory" button on the import screen.
 */
export function rematchUnmatchedBills(periodId?: number): { linked: number; promoted: number } {
  const db = getDb()
  let linked = 0
  let promoted = 0
  db.transaction(() => {
    const where = periodId ? `AND b.period_id = ${periodId}` : ''
    const rows = db
      .prepare(
        `SELECT b.id AS bill_id, b.subscriber_name, b.detected_name, b.extraction_status, b.warnings, b.field_evidence,
                r.id AS rec_id
         FROM imported_bills b LEFT JOIN bill_summary_records r ON r.bill_id = b.id
         WHERE b.is_manual = 0 AND b.duplicate_of IS NULL AND (r.employee_id IS NULL OR b.mobile_number IS NULL OR b.extraction_status = 'needs_review') ${where}
         ORDER BY b.id`
      )
      .all() as {
        bill_id: number
        subscriber_name: string | null
        detected_name: string | null
        extraction_status: string
        warnings: string | null
        field_evidence: string | null
        rec_id: number | null
      }[]
    for (const row of rows) {
      const m = findEmployeeByNameMatch(row.subscriber_name ?? row.detected_name)
      const emp = m.employee
      if (!emp) continue
      let ev: Record<string, unknown> = {}
      try {
        ev = JSON.parse(row.field_evidence ?? '{}')
      } catch {
        /* fresh evidence object */
      }
      ev.mobileSource = 'directory-name'
      ev.directoryNumber = emp.mobile ?? null
      if (row.rec_id) {
        db.prepare(
          `UPDATE bill_summary_records SET employee_id=?, title=?, username=?, designation=?, mobile_number=?, updated_at=datetime('now') WHERE id=?`
        ).run(emp.id, emp.title, emp.name, emp.designation, emp.mobile, row.rec_id)
      }
      db.prepare(`UPDATE imported_bills SET mobile_number=?, field_evidence=? WHERE id=?`).run(emp.mobile ?? null, JSON.stringify(ev), row.bill_id)
      linked++
      const list = JSON.parse(row.warnings ?? '[]') as string[]
      // drop warnings whose gating rule no longer applies: the missing/foreign
      // PDF number is now only a hint, and directory warnings are re-derived
      const rest = list.filter(
        (w) =>
          !/directory record matches|directory entries could match|has no mobile number|Directory number|was not found in the Employee/i.test(w) &&
          !/No Service Number found on page 1|from another label as a guess|enter or confirm the mobile number on review|No mobile number was extracted from the PDF/i.test(w)
      )
      if (row.extraction_status === 'needs_review' && rest.length === 0) {
        db.prepare(`UPDATE imported_bills SET extraction_status='extracted', warnings=NULL WHERE id=?`).run(row.bill_id)
        promoted++
      } else if (rest.length !== list.length) {
        db.prepare(`UPDATE imported_bills SET warnings=? WHERE id=?`).run(rest.length ? JSON.stringify(rest) : null, row.bill_id)
      }
    }
  })()
  return { linked, promoted }
}

export function deleteBill(billId: number): { storedPath: string | null } {
  const bill = getBill(billId)
  getDb().prepare(`DELETE FROM imported_bills WHERE id = ?`).run(billId)
  return { storedPath: bill?.storedPath ?? null }
}

/** Reset bills stuck in 'processing' after an application restart. */
export function recoverInterruptedProcessing(): number {
  const info = getDb()
    .prepare(
      `UPDATE imported_bills SET extraction_status='pending', error_message='Processing was interrupted (application restart). Use Re-extract to retry.'
       WHERE extraction_status='processing'`
    )
    .run()
  return info.changes
}

export function createManualBill(input: {
  periodId: number
  subscriberName: string
  originalFilename?: string | null
  mobileNumber?: string | null
  basicAmount: number | null
  gst: number | null
  totalAmount: number | null
  outstanding?: number | null
  penalty?: number | null
  creditsDebits?: number | null
}): { billId: number } {
  const db = getDb()
  return db.transaction(() => {
    const split = parseSubscriberFilename(input.subscriberName)
      const info = db
        .prepare(
          `INSERT INTO imported_bills
            (period_id, original_filename, stored_path, original_path, subscriber_name, detected_title, detected_name, sr_from_filename, mobile_number,
             outstanding, penalty, bill_amount, gst, credits_debits, total_payable, extraction_status, is_manual, processed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'extracted', 1, datetime('now'))`
        )
      .run(
        input.periodId,
        input.originalFilename ?? `${input.subscriberName} (manual entry)`,
        null,
        null,
        input.subscriberName.trim(),
        split.title,
        split.name,
        split.sr,
        input.mobileNumber ?? null,
        input.outstanding ?? 0,
        input.penalty ?? 0,
        input.basicAmount,
        input.gst,
        input.creditsDebits ?? 0,
        input.totalAmount
      )
    const billId = Number(info.lastInsertRowid)
    const emp = findEmployeeByMobile(input.mobileNumber)
    db.prepare(
      `INSERT INTO bill_summary_records (bill_id, employee_id, period_id, title, username, designation, mobile_number, basic_amount, gst, outstanding, penalty, credits_debits, total_amount, deduction, include_in_report, reviewed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,1,1)`
    ).run(
      billId,
      emp?.id ?? null,
      input.periodId,
      emp?.title ?? split.title,
      emp?.name ?? split.name,
      emp?.designation ?? null,
      emp?.mobile ?? input.mobileNumber ?? null,
      input.basicAmount,
      input.gst,
      input.outstanding ?? 0,
      input.penalty ?? 0,
      input.creditsDebits ?? 0,
      input.totalAmount
    )
    return { billId }
  })()
}

export function duplicateBillsIntoPeriod(fromPeriodId: number, toPeriodId: number): number {
  const db = getDb()
  const bills = listBillsForPeriod(fromPeriodId)
  let n = 0
  db.transaction(() => {
    for (const b of bills) {
      const name = `${b.originalFilename}`
      const exists = db.prepare(`SELECT 1 FROM imported_bills WHERE period_id=? AND original_filename=?`).get(toPeriodId, name)
      if (exists) continue
      const info = db
        .prepare(
          `INSERT INTO imported_bills
            (period_id, original_filename, stored_path, original_path, subscriber_name, detected_title, detected_name, mobile_number,
             outstanding, penalty, bill_amount, gst, credits_debits, total_payable, extraction_status, warnings, is_manual, duplicate_of, processed_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'extracted', 'Copied from a previous report. Re-import PDFs to refresh values.', 1, ?, datetime('now'))`
        )
        .run(
          toPeriodId, name, null, null, b.subscriberName, b.detectedTitle, b.detectedName, b.mobileNumber,
          b.outstanding, b.penalty, b.billAmount, b.gst, b.creditsDebits, b.totalPayable, b.id
        )
      const billId = Number(info.lastInsertRowid)
      const rec = db.prepare(`SELECT * FROM bill_summary_records WHERE bill_id=?`).get(b.id) as Record<string, unknown> | undefined
      db.prepare(
        `INSERT INTO bill_summary_records (bill_id, employee_id, period_id, title, username, designation, mobile_number, basic_amount, gst, outstanding, penalty, credits_debits, total_amount, deduction, include_in_report, reviewed)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`
      ).run(billId, (rec?.employee_id as number) ?? null, toPeriodId, rec?.title as string, rec?.username as string, rec?.designation as string, rec?.mobile_number as string, rec?.basic_amount as number, rec?.gst as number, rec?.outstanding as number, rec?.penalty as number, rec?.credits_debits as number, rec?.total_amount as number, 1, 1)
      n++
    }
  })()
  return n
}
