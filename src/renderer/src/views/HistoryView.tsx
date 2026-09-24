import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Copy, Download, Eye, FileSpreadsheet, FileText, Pencil, Search, Trash2 } from 'lucide-react'
import { useApp } from '../state/store'
import { call, errMsg } from '../lib/api'
import { fmtChhRef, MONTHS, fmtDate, periodLabel } from '../lib/format'
import { Confirm, EmptyState, Field, Modal, Spinner } from '../components/ui'
import type { BillingPeriod, ReportHistoryEntry } from '../../../shared/types'

type Tab = 'drafts' | 'reports'

export default function HistoryView(): React.JSX.Element {
  const { notify, setPeriod, go, bump, dataTick } = useApp()
  const [tab, setTab] = useState<Tab>('drafts')
  const [list, setList] = useState<ReportHistoryEntry[] | null>(null)
  const [drafts, setDrafts] = useState<BillingPeriod[] | null>(null)
  const [search, setSearch] = useState('')
  const [dupFrom, setDupFrom] = useState<ReportHistoryEntry | null>(null)
  const [confirmDel, setConfirmDel] = useState<ReportHistoryEntry | null>(null)
  const [confirmDraft, setConfirmDraft] = useState<BillingPeriod | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    try {
      setList(await call(window.api.history.list(search || undefined)))
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }, [notify, search])

  /** Draft months (any month/year, previous months included). */
  const reloadDrafts = useCallback(async (): Promise<void> => {
    try {
      setDrafts(await call(window.api.drafts.list()))
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }, [notify])

  useEffect(() => {
    const t = window.setTimeout(() => void reload(), 180)
    return () => window.clearTimeout(t)
  }, [reload])

  useEffect(() => {
    void reloadDrafts()
  }, [reloadDrafts, dataTick])

  const exportSnap = async (e: ReportHistoryEntry, kind: 'pdf' | 'xlsx'): Promise<void> => {
    setBusy(`${e.id}:${kind}`)
    try {
      const snap = await call(window.api.history.snapshotForExport(e.id))
      const fn = kind === 'pdf' ? window.api.report.exportPdf : window.api.report.exportXlsx
      const res = await call(fn({ snapshot: snap }))
      if (res.saved) notify(`Re-exported: ${res.path}`, 'ok')
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const openInApp = async (e: ReportHistoryEntry): Promise<void> => {
    setBusy(`open:${e.id}`)
    try {
      const all = await call(window.api.periods.list())
      const p = all.find((x) => x.id === e.periodId)
      if (!p) {
        notify('The billing period behind this report was deleted, so it cannot be opened for editing.', 'err')
        return
      }
      setPeriod(p)
      go('summary')
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(null)
    }
  }

  const view = async (e: ReportHistoryEntry): Promise<void> => {
    try {
      const snap = await call(window.api.history.snapshotForExport(e.id))
      await call(window.api.report.preview({ snapshot: snap }))
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  /** Open a previous draft month for reviewing/editing its Bill Summary. */
  const openDraft = (d: BillingPeriod): void => {
    setPeriod(d)
    go('summary')
  }

  const deleteDraft = async (d: BillingPeriod): Promise<void> => {
    try {
      const res = await call(window.api.drafts.remove(d.id))
      notify(
        `Draft ${res.label} deleted — ${res.billsDeleted} bill${res.billsDeleted === 1 ? '' : 's'} and their summary data were removed. Employee & SIM Directory untouched.`,
        'ok'
      )
      setConfirmDraft(null)
      await reloadDrafts()
      bump()
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const draftCount = drafts?.length ?? 0
  const reportCount = list?.length ?? 0

  return (
    <div className="flex flex-col gap-4 max-w-[1280px]">
      <div className="card p-3.5 flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--panel-2)' }}>
          <button
            className={`btn btn-sm ${tab === 'drafts' ? 'btn-primary' : ''}`}
            onClick={() => setTab('drafts')}
            title="Unfinalized billing months you can still edit or delete"
          >
            <FileText size={13} /> Drafts {drafts ? `(${draftCount})` : ''}
          </button>
          <button
            className={`btn btn-sm ${tab === 'reports' ? 'btn-primary' : ''}`}
            onClick={() => setTab('reports')}
            title="Saved (finalized) Bill Summary Reports"
          >
            <Archive size={13} /> Saved reports {list ? `(${reportCount})` : ''}
          </button>
        </div>
        {tab === 'reports' && (
          <div className="relative flex-1 max-w-[420px]">
            <Search size={14} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--mut)' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Search by month, year or report title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        <div className="text-[12px] ml-auto" style={{ color: 'var(--mut)' }}>
          {tab === 'drafts'
            ? drafts
              ? `${draftCount} draft month${draftCount === 1 ? '' : 's'} — delete any month, including previous ones`
              : ''
            : list
              ? `${reportCount} saved report${reportCount === 1 ? '' : 's'}`
              : ''}
        </div>
      </div>

      {tab === 'drafts' ? (
        <div className="card overflow-hidden">
          {!drafts ? (
            <div className="p-8 text-center"><Spinner label="Loading drafts…" /></div>
          ) : drafts.length === 0 ? (
            <EmptyState
              icon={<FileText size={26} />}
              title="No drafts"
              body="Every billing month you open appears here until you finalize it. Drafts can be reopened for editing or deleted — for the current month or any previous one."
            />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Billing month</th>
                  <th className="num" style={{ width: 90 }}>Bills</th>
                  <th style={{ width: 130 }}>Status</th>
                  <th style={{ width: 150 }}>Last change</th>
                  <th style={{ width: 230 }}></th>
                </tr>
              </thead>
              <tbody>
                {drafts.map((d) => (
                  <tr key={d.id} className="draft-row">
                    <td>
                      <div className="font-semibold">{periodLabel(d.month, d.year)}</div>
                      {d.reportTitle && (
                        <div className="text-[11px]" style={{ color: 'var(--mut)' }}>{d.reportTitle}</div>
                      )}
                    </td>
                    <td className="num">{d.billCount}</td>
                    <td><span className="badge badge-warn">Draft</span></td>
                    <td className="text-[12px]">{(d.updatedAt ?? d.createdAt).slice(0, 10)}</td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <button
                          className="btn btn-sm"
                          title="Open this month for reviewing / editing"
                          onClick={() => openDraft(d)}
                        >
                          <Pencil size={13} /> Open draft
                        </button>
                        <button
                          className="btn btn-sm draft-delete"
                          title="Delete this draft (bills and summary data)"
                          onClick={() => setConfirmDraft(d)}
                        >
                          <Trash2 size={13} /> Delete Draft
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          {!list ? (
            <div className="p-8 text-center"><Spinner label="Loading history…" /></div>
          ) : list.length === 0 ? (
            <EmptyState icon={<Archive size={26} />} title="No saved reports" body="Finalized Bill Summary Reports are stored here and survive restarts. Historical reports are never changed unless you re-finalize the same period." />
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Report</th>
                  <th style={{ width: 130 }}>Period</th>
                  <th style={{ width: 110 }}>Report date</th>
                  <th className="num" style={{ width: 70 }}>Bills</th>
                  <th className="num" style={{ width: 150 }}>Grand Total Payable</th>
                  <th style={{ width: 210 }}></th>
                </tr>
              </thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>
                      <div className="font-semibold">{e.reportName}</div>
                      <div className="text-[11px]" style={{ color: 'var(--mut)' }}>
                        saved {fmtDate(e.createdAt.slice(0, 10))}{e.modifiedAt ? ` · re-saved ${fmtDate(e.modifiedAt.slice(0, 10))}` : ''}
                      </div>
                    </td>
                    <td>
                      {e.periodLabel}
                      {e.payableBeforeFormatted ? <div className="text-[11px]" style={{ color: 'var(--mut)' }}>payable {e.payableBeforeFormatted}</div> : e.prepLabel ? <div className="text-[11px]" style={{ color: 'var(--mut)' }}>prepared {e.prepLabel}</div> : null}
                    </td>
                    <td>{e.reportDate ? fmtDate(e.reportDate) : '—'}</td>
                    <td className="num">{e.rowCount}</td>
                    <td className="num font-bold">Nu. {fmtChhRef(e.grandTotalPayable)}</td>
                    <td>
                      <div className="flex gap-1 justify-end">
                        <button className="btn btn-sm" title="Preview stored report" onClick={() => void view(e)}><Eye size={13} /></button>
                        <button className="btn btn-sm" title="Export stored Excel copy" disabled={busy === `${e.id}:xlsx`} onClick={() => void exportSnap(e, 'xlsx')}>
                          {busy === `${e.id}:xlsx` ? '…' : <FileSpreadsheet size={13} />}
                        </button>
                        <button className="btn btn-sm" title="Export stored PDF copy" disabled={busy === `${e.id}:pdf`} onClick={() => void exportSnap(e, 'pdf')}>
                          {busy === `${e.id}:pdf` ? '…' : <Download size={13} />}
                        </button>
                        <button className="btn btn-sm" title="Open this period for editing" onClick={() => void openInApp(e)}>
                          {busy === `open:${e.id}` ? '…' : <Pencil size={13} />}
                        </button>
                        <button className="btn btn-sm" title="Duplicate as new period" onClick={() => setDupFrom(e)}><Copy size={13} /></button>
                        <button className="btn btn-sm" title="Delete saved report" onClick={() => setConfirmDel(e)}><Trash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {dupFrom && (
        <DuplicateModal
          entry={dupFrom}
          onClose={() => setDupFrom(null)}
          onDone={() => {
            setDupFrom(null)
            void reload()
            void reloadDrafts()
            bump()
          }}
        />
      )}

      {/* Draft deletion — separate from deleting a finalized report below. */}
      {confirmDraft && (
        <Confirm
          danger
          title={`Delete draft — ${periodLabel(confirmDraft.month, confirmDraft.year)}`}
          confirmLabel="Delete Draft"
          body={
            <>
              Delete the <b>{periodLabel(confirmDraft.month, confirmDraft.year)}</b> draft? Its{' '}
              <b>{confirmDraft.billCount} bill{confirmDraft.billCount === 1 ? '' : 's'}</b> and all of their summary data
              (amounts, deductions, extracted values) will be removed from this draft.
              <div className="mt-3 text-[12px]" style={{ color: 'var(--mut)' }}>
                The Employee &amp; SIM Directory is not affected, and any saved (finalized) report stays in Report
                History — deleting a draft never deletes a finalized report.
              </div>
            </>
          }
          onConfirm={() => void deleteDraft(confirmDraft)}
          onClose={() => setConfirmDraft(null)}
        />
      )}

      {confirmDel && (
        <Confirm
          danger
          title="Delete saved report"
          confirmLabel="Delete report"
          body={<>Delete the stored report <b>{confirmDel.reportName}</b>? The underlying period and its bills remain untouched.</>}
          onConfirm={async () => {
            try {
              await call(window.api.history.remove(confirmDel.id))
              notify('Report removed from history.', 'ok')
              await reload()
              await reloadDrafts()
            } catch (err) {
              notify(errMsg(err), 'err')
            }
          }}
          onClose={() => setConfirmDel(null)}
        />
      )}
    </div>
  )
}

function DuplicateModal({ entry, onClose, onDone }: { entry: ReportHistoryEntry; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const { notify, periods } = useApp()
  const parts = entry.periodLabel.split(' ')
  const monthIdx = Math.max(0, MONTHS.findIndex((m) => m === parts[0]))
  const [month, setMonth] = useState(monthIdx + 1)
  const [year, setYear] = useState(parseInt(parts[1] ?? '0', 10) || new Date().getFullYear())
  const [title, setTitle] = useState(`Postpaid Bill Summary – ${MONTHS[month - 1]} ${year}`)
  const [busy, setBusy] = useState(false)

  const take = async (): Promise<void> => {
    setBusy(true)
    try {
      const r = await call(window.api.periods.duplicate(entry.periodId, month, year, title.trim() || null))
      notify(`Created ${MONTHS[month - 1]} ${year} with ${r.copied} copied records — re-import the new PDFs to refresh amounts.`, 'ok')
      onDone()
      onClose()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const conflict = useMemo(
    () => periods.some((p) => p.month === month && p.year === year),
    [periods, month, year]
  )

  return (
    <Modal
      title={`Duplicate “${entry.reportName}” as a new period`}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void take()} disabled={busy || conflict}>{busy ? 'Creating…' : 'Create period'}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="Billing month">
          <select className="select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
        </Field>
        <Field label="Billing year">
          <select className="select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Report title">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </div>
      {conflict && <div className="mt-2 text-[12px]" style={{ color: 'var(--bad)' }}>That month/year already exists — choose another period.</div>}
      <div className="text-[12px] mt-3" style={{ color: 'var(--mut)' }}>
        Employee links, deductions and amounts are copied as a starting point; the PDFs themselves are not copied, so re-import each bill for fresh extraction.
      </div>
    </Modal>
  )
}
