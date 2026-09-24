import React, { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Calculator,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Pencil,
  Printer,
  TriangleAlert,
  Trash2,
  FilePlus2
} from 'lucide-react'
import { useApp } from '../state/store'
import { assignSrs, sortByFileSr } from '../../../shared/subscriber'
import { call, errMsg } from '../lib/api'
import { fmtChhRef, todayIso } from '../lib/format'
import { AmountInput, Confirm, Modal, MonthYearSelect } from '../components/ui'
import { RecordEditor } from '../components/RecordEditor'
import type { BillRecord, ReportSnapshot } from '../../../shared/types'
import { formatPayableBefore } from '../../../shared/payable'

type SortKey = 'username' | 'designation' | 'mobileNumber' | 'outstanding' | 'penalty' | 'basicAmount' | 'gst' | 'creditsDebits' | 'totalAmount' | 'deduction'
type Dir = 1 | -1

export default function SummaryView(): React.JSX.Element {
  const { period, dataTick, bump, notify, settings, refreshPeriods } = useApp()
  const [records, setRecords] = useState<BillRecord[]>([])
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<Dir>(1)
  const [editing, setEditing] = useState<BillRecord | null>(null)
  const [confirmDel, setConfirmDel] = useState<BillRecord | null>(null)
  const [issues, setIssues] = useState<{ billId: number; fileName: string; reason: string }[]>([])
  const [finalOpen, setFinalOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(todayIso())
  const [exporting, setExporting] = useState<'pdf' | 'xlsx' | null>(null)

  useEffect(() => {
    if (!period) return
    setTitle(period.reportTitle || `Postpaid Bill Summary – ${periodLabelOf(period.month, period.year)}`)
    setDate(period.reportDate || todayIso())
  }, [period, dataTick])

  const periodLabelOf = (m: number, y: number): string =>
    ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][m - 1] + ` ${y}`

  useEffect(() => {
    if (!period) return
    void (async () => {
      try {
        const [rs, iss] = await Promise.all([call(window.api.records.list(period.id)), call(window.api.report.issues(period.id))])
        setRecords(rs)
        setIssues(iss)
      } catch (err) {
        notify(errMsg(err), 'err')
      }
    })()
  }, [period, dataTick, notify])

  const sorted = useMemo(() => {
    const incl = records
    if (!sortKey) return sortByFileSr(incl)
    const dir = sortDir
    return [...incl].sort((a, b) => {
      const va = a[sortKey]
      const vb = b[sortKey]
      if (va === null || va === undefined) return 1
      if (vb === null || vb === undefined) return -1
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir
      return String(va).localeCompare(String(vb), undefined, { sensitivity: 'base' }) * dir
    })
  }, [records, sortKey, sortDir])
  const srLabels = useMemo(() => assignSrs(sorted), [sorted])

  const included = records.filter((r) => r.includeInReport)
  const sum = (key: 'outstanding' | 'penalty' | 'basicAmount' | 'gst' | 'creditsDebits' | 'totalAmount' | 'deduction'): number | null => {
    let acc = 0
    let any = false
    for (const r of included) {
      const v = r[key]
      if (v === null || v === undefined) continue
      acc += v
      any = true
    }
    return any ? acc : 0
  }
  const totals = {
    outstanding: sum('outstanding'),
    penalty: sum('penalty'),
    basic: sum('basicAmount'),
    gst: sum('gst'),
    credits: sum('creditsDebits'),
    total: sum('totalAmount'),
    deduction: sum('deduction')
  }

  const head = (key: SortKey, label: string, num = false): React.JSX.Element => (
    <th
      className={num ? 'num cursor-pointer select-none' : 'cursor-pointer select-none'}
      onClick={() => {
        if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1))
        else {
          setSortKey(key)
          setSortDir(1)
        }
      }}
      title="Click to sort"
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {sortKey === key && (sortDir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </span>
    </th>
  )

  const patch = async (id: number, p: Partial<BillRecord>): Promise<void> => {
    try {
      await call(window.api.records.update(id, p))
      bump()
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const autoGst = async (r: BillRecord): Promise<void> => {
    try {
      await call(window.api.records.autoCalcGst(r.id))
      bump()
      notify(`GST calculated at ${settings?.gstRatePercent ?? 5}% of the basic amount.`, 'ok')
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const exportReport = async (kind: 'pdf' | 'xlsx'): Promise<void> => {
    if (!period) return
    setExporting(kind)
    try {
      const fn = kind === 'pdf' ? window.api.report.exportPdf : window.api.report.exportXlsx
      const res = await call(fn({ periodId: period.id }))
      if (res.saved) notify(`Saved: ${res.path}`, 'ok')
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setExporting(null)
    }
  }

  const preview = async (): Promise<void> => {
    if (!period) return
    try {
      await call(window.api.report.preview({ periodId: period.id }))
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const saveMeta = async (): Promise<void> => {
    if (!period) return
    try {
      await call(window.api.periods.update(period.id, { reportTitle: title.trim() || null, reportDate: date }))
      bump()
      void refreshPeriods()
      notify('Report title & date saved.', 'ok')
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  if (!period) return <div className="text-[13px]" style={{ color: 'var(--mut)' }}>Select a billing period in the header first.</div>

  return (
    <div className="flex flex-col gap-4 max-w-[1500px]">
      <div className="card p-4 flex flex-col gap-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: '2fr 1fr auto', alignItems: 'end' }}>
        <label className="block">
          <span className="label">Report title</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveMeta()} />
        </label>
        <label className="block">
          <span className="label">Report date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} onBlur={() => void saveMeta()} />
        </label>
        <div className="flex gap-2 justify-end flex-wrap">
          {/* Report-level action: renders the GENERATED report for printing — not a bill-PDF viewer. */}
          <button className="btn" onClick={() => void preview()}><Printer size={14} /> Preview / print report</button>
          <button className="btn" disabled={exporting === 'xlsx'} onClick={() => void exportReport('xlsx')}>
            {exporting === 'xlsx' ? <span className="animate-pulse">…</span> : <FileSpreadsheet size={14} />} Excel .xlsx
          </button>
          <button className="btn" disabled={exporting === 'pdf'} onClick={() => void exportReport('pdf')}>
            {exporting === 'pdf' ? <span className="animate-pulse">…</span> : <Download size={14} />} PDF
          </button>
          <button className="btn btn-primary" onClick={() => setFinalOpen(true)}>
            <Archive size={14} /> Finalize & save report
          </button>
        </div>
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr auto', alignItems: 'end' }}>
          <div>
            <span className="label" title="The month the imported postpaid bills actually belong to — never derived from the current date">
              Actual Billing Month (the month these bills belong to)
            </span>
            <MonthYearSelect
              label="Actual billing month"
              month={period.month}
              year={period.year}
              onChange={(m, y) => void (async () => {
                try {
                  await call(window.api.periods.setBillingMonth(period.id, m, y))
                  void refreshPeriods()
                  bump()
                  notify(`Actual billing month set to ${periodLabelOf(m, y)}.`, 'ok')
                } catch (err) {
                  notify(errMsg(err), 'err')
                }
              })()}
            />
          </div>
          <div>
            <span className="label" title="Date before which the combined bills must be paid — chosen manually via calendar, displayed as DD|MM|YYYY">
              Payable Before (DD|MM|YYYY)
            </span>
            <input
              className="input"
              type="date"
              value={period.payableBefore ?? ''}
              onChange={(e) => {
                const v = e.target.value || null
                void (async () => {
                  try {
                    await call(window.api.periods.setPayableBefore(period.id, v))
                    void refreshPeriods()
                    bump()
                  } catch (err) {
                    notify(errMsg(err), 'err')
                  }
                })()
              }}
            />
          </div>
          <div className="text-[12px]" style={{ color: 'var(--mut)' }}>
            Billing month: <b>{periodLabelOf(period.month, period.year)}</b>
            <br />
            Payable Before: <b>{period.payableBefore ? (formatPayableBefore(period.payableBefore) ?? period.payableBefore) : 'not set'}</b>
            <br />
            Status: <b>{period.status === 'finalized' ? 'Finalized' : 'Draft'}</b>
          </div>
        </div>
      </div>

      {issues.length > 0 && (
        <div className="card p-3.5 flex items-start gap-3" style={{ borderColor: 'var(--warn)' }}>
          <TriangleAlert size={18} style={{ color: 'var(--warn)', marginTop: 2 }} />
          <div className="text-[13px]">
            <b>{issues.length} record{issues.length === 1 ? '' : 's'} must be resolved before finalizing.</b> The report will not be saved while failed or
            unreviewed extractions are included.
            <ul className="mt-1 pl-4 list-disc" style={{ color: 'var(--mut)' }}>
              {issues.slice(0, 4).map((i) => (
                <li key={i.billId}>{i.fileName}: {i.reason}</li>
              ))}
              {issues.length > 4 && <li>…and {issues.length - 4} more</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-auto max-h-[58vh]">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 44 }}>Sr.</th>
                <th style={{ width: 40 }} title="Include in report">Incl.</th>
                <th style={{ width: 56 }}>Title</th>
                {head('username', 'Username')}
                {head('designation', 'Designation')}
                {head('mobileNumber', 'Number')}
                {head('outstanding', 'Outstanding', true)}
                {head('penalty', 'Penalty', true)}
                {head('basicAmount', 'Bill Amount', true)}
                {head('gst', `GST @ ${settings?.gstRatePercent ?? 5}%`, true)}
                {head('creditsDebits', 'Credits / Debits', true)}
                {head('totalAmount', 'Total Payable', true)}
                {head('deduction', 'Deduction', true)}
                <th style={{ width: 130 }}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, idx) => (
                <tr key={r.id} style={{ opacity: r.includeInReport ? 1 : 0.5 }}>
                  <td className="num" style={{ textAlign: 'center' }}>{srLabels[idx]}</td>
                  <td style={{ textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={r.includeInReport}
                      onChange={(e) => void patch(r.id, { includeInReport: e.target.checked })}
                      title="Include this record in the report and grand totals"
                    />
                  </td>
                  <td>{r.title || '—'}</td>
                  <td className="font-semibold">{r.username ?? <span style={{ color: 'var(--bad)' }}>missing</span>}</td>
                  <td>{r.designation || <span style={{ color: 'var(--mut)' }}>—</span>}</td>
                  <td className="mono">{r.mobileNumber ?? <span style={{ color: 'var(--bad)' }}>missing</span>}</td>
                  <td className="num">{r.outstanding === null ? <span style={{ color: 'var(--mut)' }}>—</span> : fmtChhRef(r.outstanding)}</td>
                  <td className="num">{r.penalty === null ? <span style={{ color: 'var(--mut)' }}>—</span> : fmtChhRef(r.penalty)}</td>
                  <td className="num">
                    {fmtChhRef(r.basicAmount)}
                    {r.reviewed && <CheckCircle2 size={11} style={{ color: 'var(--ok)', marginLeft: 5, verticalAlign: -1 }} aria-label="reviewed" />}
                  </td>
                  <td className="num">
                    {r.gst === null ? (
                      <button className="btn btn-sm" title="Calculate GST from basic amount" onClick={() => void autoGst(r)}>
                        <Calculator size={12} /> calc
                      </button>
                    ) : (
                      fmtChhRef(r.gst)
                    )}
                  </td>
                                    <td className="num">{r.creditsDebits === null ? <span style={{ color: 'var(--mut)' }}>—</span> : fmtChhRef(r.creditsDebits)}</td>
                  <td className="num font-bold">
                    {fmtChhRef(r.totalAmount)}
                    {r.mismatchChh !== null && r.mismatchChh !== 0 && (
                      <span
                        className="badge badge-warn"
                        style={{ marginLeft: 6 }}
                        title={
                          Math.abs(r.mismatchChh) <= 100
                            ? 'Bill components + Outstanding/Penalty/Credits differ from the printed Total Payable by Nu. ' + fmtChhRef(r.mismatchChh) + ' — bill-side rounding; Total Payable is kept exactly as printed.'
                            : 'Bill Amount + GST + Outstanding + Penalty + Credits/Debits does not equal the printed Total Payable (difference Nu. ' + fmtChhRef(r.mismatchChh) + '). Open the review sheet and verify the extracted amounts.'
                        }
                      >
                        <TriangleAlert size={11} /> Δ {fmtChhRef(r.mismatchChh)}
                      </span>
                    )}
                  </td>
                  <td className="num" style={{ width: 120 }}>
                    <AmountInput
                      value={r.deduction}
                      onChange={(v) => void patch(r.id, { deduction: v ?? 0 })}
                      placeholder="0.00"
                    />
                  </td>
                  <td>
                    <div className="flex gap-1 justify-end">
                      <button className="btn btn-sm" onClick={() => setEditing(r)} title="Edit subscriber info and amounts"><Pencil size={13} /></button>
                      <button className="btn btn-sm" onClick={() => setConfirmDel(r)} title="Remove record and its bill"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={14} className="text-center py-10" style={{ color: 'var(--mut)' }}>
                    No bills in this period yet. Use <FilePlus2 size={13} style={{ display: 'inline', verticalAlign: -2 }} /> Import PDF Bills first.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={6} className="num" style={{ fontWeight: 800 }}>GRAND TOTAL ({included.length} included)</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.outstanding)}</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.penalty)}</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.basic)}</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.gst)}</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.credits)}</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.total)}</td>
                <td className="num" style={{ fontWeight: 800 }}>Nu. {fmtChhRef(totals.deduction)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {editing && <RecordEditor record={editing} onClose={() => setEditing(null)} />}
      {confirmDel && (
        <Confirm
          danger
          title="Remove summary record"
          confirmLabel="Remove"
          body={<>This deletes the summary row and its linked imported bill (the stored PDF copy) for <b>{confirmDel.bill?.originalFilename}</b>. Your original file on disk is untouched.</>}
          onConfirm={async () => {
            try {
              await call(window.api.records.remove(confirmDel.id))
              bump()
              notify('Record removed.', 'ok')
            } catch (err) {
              notify(errMsg(err), 'err')
            }
          }}
          onClose={() => setConfirmDel(null)}
        />
      )}

      {finalOpen && (
        <FinalizeModal
          onClose={() => setFinalOpen(false)}
          periodId={period.id}
          defaultTitle={title}
          defaultDate={date}
          onDone={() => {
            setFinalOpen(false)
            bump()
            void refreshPeriods()
          }}
        />
      )}
    </div>
  )
}

function FinalizeModal({
  periodId,
  defaultTitle,
  defaultDate,
  onClose,
  onDone
}: {
  periodId: number
  defaultTitle: string
  defaultDate: string
  onClose: () => void
  onDone: () => void
}): React.JSX.Element {
  const { notify } = useApp()
  const [name, setName] = useState(defaultTitle)
  const [date, setDate] = useState(defaultDate)
  const [busy, setBusy] = useState(false)
  const [snapshot, setSnapshot] = useState<ReportSnapshot | null>(null)

  useEffect(() => {
    void call(window.api.report.snapshot(periodId)).then(setSnapshot).catch(() => undefined)
  }, [periodId])

  const finalize = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call(window.api.report.finalize(periodId, name.trim(), date))
      if (r.ok === true) {
        notify(`Report “${name.trim()}” saved to history.`, 'ok')
        onDone()
      } else {
        notify(`Cannot finalize yet:\n${r.issues.map((i) => `${i.fileName}: ${i.reason}`).join('\n')}`, 'err')
      }
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Finalize Bill Summary Report" onClose={onClose} width={560}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void finalize()} disabled={busy}>{busy ? 'Saving…' : 'Finalize & save'}</button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="block">
          <span className="label">Report title</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="label">Report date</span>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        {snapshot && (
          <div className="rounded-lg p-3 text-[13px]" style={{ background: 'var(--panel-2)' }}>
            {snapshot.rows.length} record{snapshot.rows.length === 1 ? '' : 's'} · Billing month <b>{snapshot.billingLabel ?? snapshot.periodLabel}</b>
            {snapshot.payableBeforeFormatted ? <> · Payable Before <b>{snapshot.payableBeforeFormatted}</b></> : snapshot.prepLabel ? <> · Prepared in <b>{snapshot.prepLabel}</b></> : <> · <span style={{ color: 'var(--warn)' }}>Payable Before not set</span></>}
            <br />
            Grand Total Payable <b>Nu. {fmtChhRef(snapshot.totals.total)}</b> · Deductions <b>Nu. {fmtChhRef(snapshot.totals.deduction)}</b>
          </div>
        )}
        <div className="text-[12px]" style={{ color: 'var(--mut)' }}>
          The finalized report is stored in Report History. Later edits to this period will not change already saved history entries
          unless you finalize again.
        </div>
      </div>
    </Modal>
  )
}
