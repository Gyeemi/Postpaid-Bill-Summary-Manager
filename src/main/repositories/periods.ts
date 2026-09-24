import { getDb } from '../db'
import type { BillingPeriod } from '../../shared/types'

interface PeriodRow {
  id: number
  month: number
  year: number
  prep_month: number | null
  prep_year: number | null
  payable_before: string | null
  report_title: string | null
  report_date: string | null
  status: 'draft' | 'finalized'
  created_at: string
  updated_at: string | null
  bill_count?: number
}

export function periodLabel(month: number, year: number): string {
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${names[month - 1] ?? '?'} ${year}`
}

function map(r: PeriodRow): BillingPeriod {
  return {
    id: r.id,
    month: r.month,
    year: r.year,
    prepMonth: r.prep_month ?? null,
    prepYear: r.prep_year ?? null,
    payableBefore: (r as any).payable_before ?? null,
    reportTitle: r.report_title,
    reportDate: r.report_date,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    billCount: r.bill_count ?? 0
  }
}

export function listPeriods(): BillingPeriod[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM imported_bills b WHERE b.period_id = p.id) AS bill_count
       FROM billing_periods p ORDER BY p.year DESC, p.month DESC`
    )
    .all() as PeriodRow[]
  return rows.map(map)
}

export function getPeriod(id: number): BillingPeriod | null {
  const r = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM imported_bills b WHERE b.period_id = p.id) AS bill_count
       FROM billing_periods p WHERE p.id = ?`
    )
    .get(id) as PeriodRow | undefined
  return r ? map(r) : null
}

export function findPeriod(month: number, year: number): BillingPeriod | null {
  const r = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM imported_bills b WHERE b.period_id = p.id) AS bill_count
       FROM billing_periods p WHERE p.month = ? AND p.year = ?`
    )
    .get(month, year) as PeriodRow | undefined
  return r ? map(r) : null
}

export function getOrCreatePeriod(month: number, year: number, reportTitle?: string | null): BillingPeriod {
  const existing = findPeriod(month, year)
  if (existing) {
    if (reportTitle && !existing.reportTitle) {
      getDb()
        .prepare(`UPDATE billing_periods SET report_title = ?, updated_at = datetime('now') WHERE id = ?`)
        .run(reportTitle, existing.id)
    }
    return findPeriod(month, year)!
  }
  const info = getDb()
    .prepare(`INSERT INTO billing_periods (month, year, report_title) VALUES (?,?,?)`)
    .run(month, year, reportTitle ?? null)
  return getPeriod(Number(info.lastInsertRowid))!
}

export function updatePeriod(
  id: number,
  patch: Partial<{ reportTitle: string | null; reportDate: string | null; status: 'draft' | 'finalized' }>
): BillingPeriod | null {
  const db = getDb()
  const cur = getPeriod(id)
  if (!cur) return null
  db.prepare(
    `UPDATE billing_periods SET report_title=?, report_date=?, status=?, updated_at=datetime('now') WHERE id=?`
  ).run(
    patch.reportTitle !== undefined ? patch.reportTitle || null : cur.reportTitle,
    patch.reportDate !== undefined ? patch.reportDate || null : cur.reportDate,
    patch.status ?? cur.status,
    id
  )
  return getPeriod(id)
}

/** Move a period to a different ACTUAL billing month. No automatic relation to
 *  the preparation month is enforced; collides only if another period owns it. */
export function setActualBillingMonth(id: number, month: number, year: number): BillingPeriod {
  const db = getDb()
  const cur = getPeriod(id)
  if (!cur) throw new Error('Billing period not found')
  if (cur.month === month && cur.year === year) return cur
  const clash = db.prepare(`SELECT id, (SELECT COUNT(*) FROM imported_bills b WHERE b.period_id = p.id) AS n FROM billing_periods p WHERE month = ? AND year = ? AND id != ?`).get(month, year, id) as { id: number; n: number } | undefined
  if (clash) throw new Error(`${periodLabel(month, year)} is already used by another billing period (${clash.n} bills). Import into that period instead, or pick another month.`)
  db.transaction(() => {
    db.prepare(`UPDATE billing_periods SET month=?, year=?, updated_at=datetime('now') WHERE id=?`).run(month, year, id)
    // the default draft title follows the month until the user edits it
    const t = db.prepare(`SELECT report_title FROM billing_periods WHERE id=?`).get(id) as { report_title: string | null }
    const re = /^Postpaid Bill Summary – (.+)$/
    const m = t.report_title ? re.exec(t.report_title) : null
    if (m) db.prepare(`UPDATE billing_periods SET report_title=? WHERE id=?`).run(`Postpaid Bill Summary – ${periodLabel(month, year)}`, id)
  })()
  return getPeriod(id)!
}

/** Legacy: Independent "Bill Preparation Month" for this report; null clears it. Kept for old DBs. */
export function setPrepMonth(id: number, month: number | null, year: number | null): BillingPeriod {
  const db = getDb()
  if (!getPeriod(id)) throw new Error('Billing period not found')
  db.prepare(`UPDATE billing_periods SET prep_month=?, prep_year=?, updated_at=datetime('now') WHERE id=?`).run(month, year, id)
  return getPeriod(id)!
}

/** Payable Before date — ISO yyyy-mm-dd, manually chosen; null clears it. */
export function setPayableBefore(id: number, isoDate: string | null): BillingPeriod {
  const db = getDb()
  if (!getPeriod(id)) throw new Error('Billing period not found')
  if (isoDate !== null) {
    // strict ISO check
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error('Invalid Payable Before date')
    const [y, m, d] = isoDate.split('-').map(Number)
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) throw new Error('Invalid Payable Before date')
    const dim = new Date(y, m, 0).getDate()
    if (d > dim) throw new Error('Invalid Payable Before date')
  }
  db.prepare(`UPDATE billing_periods SET payable_before=?, updated_at=datetime('now') WHERE id=?`).run(isoDate, id)
  return getPeriod(id)!
}

export function deletePeriod(id: number): void {
  getDb().prepare(`DELETE FROM billing_periods WHERE id = ?`).run(id)
}

export function searchPeriods(query: string): BillingPeriod[] {
  const q = query.trim().toLowerCase()
  if (!q) return listPeriods()
  return listPeriods().filter((p) => periodLabel(p.month, p.year).toLowerCase().includes(q) || String(p.year).includes(q))
}

/**
 * Drafts = billing months that have NOT been finalized into Report History.
 * Listed explicitly so Delete Draft is available for every previous
 * month/year, exactly like the current one.
 */
export function listDrafts(): BillingPeriod[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*, (SELECT COUNT(*) FROM imported_bills b WHERE b.period_id = p.id) AS bill_count
       FROM billing_periods p
       WHERE NOT EXISTS (SELECT 1 FROM report_history h WHERE h.period_id = p.id)
       ORDER BY p.year DESC, p.month DESC`
    )
    .all() as PeriodRow[]
  return rows.map(map)
}

export interface DraftDeleteResult {
  periodId: number
  label: string
  billsDeleted: number
}

/**
 * Deletes a DRAFT billing month: its imported bills, its draft summary
 * records and the month itself (SQLite ON DELETE CASCADE covers the child
 * rows; the explicit deletes keep old databases consistent too).
 *
 * Never touches the Employee & SIM Directory, and refuses when the month has
 * a finalized report — that has to be removed through the separate
 * "Delete report" action in Report History.
 */
export function deleteDraft(id: number): DraftDeleteResult {
  const db = getDb()
  const p = getPeriod(id)
  if (!p) throw new Error('Billing month not found')
  const saved = db.prepare(`SELECT id, report_name FROM report_history WHERE period_id = ?`).get(id) as
    | { id: number; report_name: string }
    | undefined
  if (saved) {
    throw new Error(
      `${periodLabel(p.month, p.year)} has a finalized report (“${saved.report_name}”) in Report History. ` +
        `Delete that saved report first, then the draft can be deleted.`
    )
  }
  const billsDeleted = p.billCount
  db.transaction(() => {
    db.prepare(`DELETE FROM bill_summary_records WHERE period_id = ?`).run(id)
    db.prepare(`DELETE FROM imported_bills WHERE period_id = ?`).run(id)
    db.prepare(`DELETE FROM billing_periods WHERE id = ?`).run(id)
  })()
  return { periodId: id, label: periodLabel(p.month, p.year), billsDeleted }
}
