import { getDb } from '../db'
import type { ReportHistoryEntry, ReportSnapshot } from '../../shared/types'
import { periodLabel } from './periods'
import { computeTotals, includedRowsForSnapshot, unreviewedIssues } from './records'
import { getSettings } from './settings'
import { buildSnapshotBase } from '../util/snapshot'
import { formatPayableBefore } from '../../shared/payable'

interface RepRow {
  id: number
  period_id: number
  report_name: string
  report_date: string | null
  snapshot_json: string
  grand_total_basic: number | null
  grand_total_gst: number | null
  grand_total_payable: number | null
  grand_total_deduction: number | null
  row_count: number
  created_at: string
  modified_at: string | null
  month?: number
  year?: number
  prep_month?: number | null
  prep_year?: number | null
  payable_before?: string | null
}

function map(r: RepRow): ReportHistoryEntry {
  const snap = (() => {
    try {
      return JSON.parse(r.snapshot_json) as ReportSnapshot
    } catch {
      return null
    }
  })()
  const pbIso = (r as any).payable_before ?? snap?.payableBefore ?? null
  return {
    id: r.id,
    periodId: r.period_id,
    periodLabel: r.month && r.year ? periodLabel(r.month, r.year) : '',
    prepLabel: r.prep_month && r.prep_year ? periodLabel(r.prep_month, r.prep_year) : '',
    payableBefore: pbIso,
    payableBeforeFormatted: snap?.payableBeforeFormatted ?? formatPayableBefore(pbIso),
    reportName: r.report_name,
    reportDate: r.report_date,
    rowCount: r.row_count,
    grandTotalPayable: r.grand_total_payable,
    createdAt: r.created_at,
    modifiedAt: r.modified_at
  }
}

export function finalizeReport(
  periodId: number,
  reportName: string,
  reportDate: string
): { ok: true; entry: ReportHistoryEntry } | { ok: false; issues: { billId: number; fileName: string; reason: string }[] } {
  const issues = unreviewedIssues(periodId)
  if (issues.length > 0) return { ok: false, issues }
  const db = getDb()
  const totals = computeTotals(periodId, true)
  const snapshot: ReportSnapshot = {
    ...buildSnapshotBase(getSettings()),
    reportTitle: reportName,
    periodLabel: (() => {
      const p = db.prepare(`SELECT month, year FROM billing_periods WHERE id = ?`).get(periodId) as { month: number; year: number }
      return periodLabel(p.month, p.year)
    })(),
    ...(() => {
      const p = db.prepare(`SELECT month, year, prep_month, prep_year, payable_before FROM billing_periods WHERE id = ?`).get(periodId) as { month: number; year: number; prep_month: number | null; prep_year: number | null; payable_before: string | null }
      return {
        billingLabel: periodLabel(p.month, p.year),
        prepLabel: p.prep_month && p.prep_year ? periodLabel(p.prep_month, p.prep_year) : null,
        payableBefore: p.payable_before ?? null,
        payableBeforeFormatted: formatPayableBefore(p.payable_before ?? null)
      }
    })(),
    reportDate,
    rows: includedRowsForSnapshot(periodId),
    totals
  }
  const snapshotJson = JSON.stringify(snapshot)
  db.transaction(() => {
    db.prepare(
      `INSERT INTO report_history (period_id, report_name, report_date, snapshot_json, grand_total_basic, grand_total_gst, grand_total_payable, grand_total_deduction, row_count)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(period_id) DO UPDATE SET
         report_name=excluded.report_name, report_date=excluded.report_date, snapshot_json=excluded.snapshot_json,
         grand_total_basic=excluded.grand_total_basic, grand_total_gst=excluded.grand_total_gst,
         grand_total_payable=excluded.grand_total_payable, grand_total_deduction=excluded.grand_total_deduction,
         row_count=excluded.row_count, modified_at=datetime('now')`
    ).run(periodId, reportName, reportDate, snapshotJson, totals.basic, totals.gst, totals.total, totals.deduction, totals.count)
    db.prepare(`UPDATE billing_periods SET status='finalized', report_title=?, report_date=?, updated_at=datetime('now') WHERE id=?`).run(reportName, reportDate, periodId)
  })()
  const row = db.prepare(`SELECT * FROM report_history WHERE period_id = ?`).get(periodId) as RepRow
  return { ok: true, entry: map(row) }
}

export function listReports(search?: string): ReportHistoryEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT h.*, p.month, p.year, p.prep_month, p.prep_year, p.payable_before FROM report_history h JOIN billing_periods p ON p.id = h.period_id
       ORDER BY h.modified_at IS NULL, h.modified_at DESC, h.created_at DESC`
    )
    .all() as RepRow[]
  let out = rows.map(map)
  const q = (search ?? '').trim().toLowerCase()
  if (q) {
    out = out.filter(
      (e) => e.reportName.toLowerCase().includes(q) || e.periodLabel.toLowerCase().includes(q)
    )
  }
  return out
}

export function getReport(id: number): { entry: ReportHistoryEntry; snapshot: ReportSnapshot } | null {
  const row = getDb()
    .prepare(`SELECT h.*, p.month, p.year, p.prep_month, p.prep_year, p.payable_before FROM report_history h JOIN billing_periods p ON p.id = h.period_id WHERE h.id = ?`)
    .get(id) as RepRow | undefined
  if (!row) return null
  return { entry: map(row), snapshot: JSON.parse(row.snapshot_json) as ReportSnapshot }
}

export function deleteReport(id: number): void {
  const db = getDb()
  const row = db.prepare(`SELECT period_id FROM report_history WHERE id = ?`).get(id) as { period_id: number } | undefined
  db.prepare(`DELETE FROM report_history WHERE id = ?`).run(id)
  if (row) {
    db.prepare(`UPDATE billing_periods SET status = CASE WHEN id IN (SELECT period_id FROM report_history) THEN status ELSE 'draft' END, updated_at=datetime('now') WHERE id = ?`).run(row.period_id)
  }
}

export function latestSnapshotForPeriod(periodId: number): ReportSnapshot | null {
  const row = getDb().prepare(`SELECT snapshot_json FROM report_history WHERE period_id = ?`).get(periodId) as { snapshot_json: string } | undefined
  return row ? (JSON.parse(row.snapshot_json) as ReportSnapshot) : null
}
