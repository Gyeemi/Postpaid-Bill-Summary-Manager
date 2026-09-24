import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  UploadCloud,
  FileText,
  Play,
  RefreshCw,
  Trash2,
  Pencil,
  X,
  FilePlus2,
  ShieldAlert,
  Users
} from 'lucide-react'
import { useApp } from '../state/store'
import { call, errMsg } from '../lib/api'
import { fmtChhRef, periodLabel } from '../lib/format'
import { StatusBadge, Spinner, Field, AmountInput, Confirm, Modal } from '../components/ui'
import { RecordEditor } from '../components/RecordEditor'
import type { BillRecord, ImportResult, ImportedBill } from '../../../shared/types'
import { parseSubscriberFilename } from '../../../shared/subscriber'

interface Draft {
  path: string
  fileName: string
}

export default function ImportView(): React.JSX.Element {
  const { period, dataTick, notify, progress, statuses, setProgress } = useApp()
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bills, setBills] = useState<ImportedBill[]>([])
  const [records, setRecords] = useState<Record<number, BillRecord>>({})
  const [editing, setEditing] = useState<BillRecord | null>(null)
  const [confirmDel, setConfirmDel] = useState<ImportedBill | null>(null)
  const [manual, setManual] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [sel, setSel] = useState<ReadonlySet<number>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  const refresh = useMemo(
    () => async () => {
      if (!period) return
      const [bl, rs] = await Promise.all([call(window.api.bills.list(period.id)), call(window.api.records.list(period.id))])
      setBills(bl)
      const map: Record<number, BillRecord> = {}
      for (const r of rs) if (r.billId) map[r.billId] = r
      setRecords(map)
    },
    [period]
  )

  useEffect(() => {
    void refresh()
  }, [refresh, dataTick])

  useEffect(() => {
    setSel(new Set())
  }, [period?.id])

  // clear queued progress markers when the underlying status changed server-side
  useEffect(() => {
    for (const b of bills) {
      if (progress[b.id] && b.extractionStatus !== 'processing') setProgress(b.id, null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills])

  const addPaths = (paths: string[]): void => {
    const added: Draft[] = []
    for (const p of paths) {
      const fileName = p.split(/[\\/]/).pop() ?? p
      if (!/\.pdf$/i.test(fileName)) {
        notify(`Skipped non-PDF file: ${fileName}`, 'err')
        continue
      }
      if (drafts.some((d) => d.path === p)) continue
      added.push({ path: p, fileName })
    }
    setDrafts((d) => [...d, ...added])
  }

  const pick = async (): Promise<void> => {
    try {
      const paths = await call(window.api.bills.pickFiles())
      addPaths(paths)
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    if (!period) {
      notify('Select a billing period first (top-right).', 'err')
      return
    }
    const files = Array.from(e.dataTransfer.files ?? [])
    const paths = files.map((f) => window.api.files.pathFor(f)).filter((p) => !!p && /\.pdf$/i.test(p))
    if (paths.length !== files.length) notify('Only readable .pdf files were accepted.', 'err')
    addPaths(paths)
  }

  const doImport = async (): Promise<void> => {
    if (!period || drafts.length === 0) return
    setBusy(true)
    try {
      const res = await call(window.api.bills.import(period.id, drafts.map((d) => d.path)))
      setResult(res)
      setDrafts([])
      if (res.errors.length > 0) notify(`Some files could not be imported:\n${res.errors.map((e) => `${e.fileName}: ${e.reason}`).join('\n')}`, 'err')
      if (res.skipped.length > 0) notify(`Skipped duplicates:\n${res.skipped.map((e) => `${e.fileName}: ${e.reason}`).join('\n')}`)
      await refresh()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBusy(false)
    }
  }

  const processNow = async (billIds: number[]): Promise<void> => {
    try {
      const r = await call(window.api.bills.process(billIds))
      if (r.message) notify(r.message, 'err')
      await refresh()
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const retry = async (billId: number): Promise<void> => {
    try {
      const r = await call(window.api.bills.retry(billId))
      if (r.message) notify(r.message, 'err')
      await refresh()
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const remove = async (billId: number): Promise<void> => {
    try {
      await call(window.api.bills.remove(billId))
      notify('Bill removed from this period (the original PDF on disk was not touched).', 'ok')
      await refresh()
    } catch (err) {
      notify(errMsg(err), 'err')
    }
  }

  const removeMany = async (): Promise<void> => {
    setConfirmBulk(false)
    if (selIds.length === 0) return
    setBulkBusy(true)
    try {
      const res = await call(window.api.bills.removeMany(selIds))
      if (res.removed > 0) notify(`Removed ${res.removed} bill${res.removed === 1 ? '' : 's'} from this period. Your original PDF files on disk were not touched.`, 'ok')
      if (res.failed.length > 0) notify(`Could not remove ${res.failed.length} bill${res.failed.length === 1 ? '' : 's'}:\n${res.failed.map((f) => `${f.id}: ${f.reason}`).join('\n')}`, 'err')
      setSel(new Set())
      await refresh()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setBulkBusy(false)
    }
  }

  const selectedBills = bills.filter((b) => sel.has(b.id))
  const selIds = selectedBills.map((b) => b.id)
  const allSelected = bills.length > 0 && selIds.length === bills.length
  const toggle = (id: number): void =>
    setSel((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const toggleAll = (): void => setSel(allSelected ? new Set<number>() : new Set(bills.map((b) => b.id)))
  const chkAllRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (chkAllRef.current) chkAllRef.current.indeterminate = selIds.length > 0 && !allSelected
  }, [selIds.length, allSelected])

  const pendingIds = bills.filter((b) => b.extractionStatus === 'pending' || b.extractionStatus === 'failed').map((b) => b.id)
  const anyProcessing = bills.some((b) => b.extractionStatus === 'processing' || progress[b.id])
  const total = bills.length
  const done = bills.filter((b) => b.extractionStatus === 'extracted' || b.extractionStatus === 'needs_review' || b.extractionStatus === 'failed').length

  return (
    <div className="flex flex-col gap-4 max-w-[1400px]">
      {!period ? (
        <div className="card p-6 flex items-center gap-3">
          <ShieldAlert size={20} style={{ color: 'var(--warn)' }} />
          <div>
            <div className="font-bold">Open the actual billing month first</div>
            <div className="text-[13px]" style={{ color: 'var(--mut)' }}>
              Click the month selector in the header, choose the month these bills actually belong to (e.g. August 2026 for September bills) and press <b>Open</b>.
              The app never picks it for you.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`dropzone ${dragOver ? 'drag' : ''} p-5 flex items-center gap-5`}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <UploadCloud size={34} style={{ color: 'var(--acc-2)' }} />
            <div className="flex-1">
              <div className="font-bold text-[14.5px]">Drop postpaid bill PDFs here</div>
              <div className="text-[12.5px]" style={{ color: 'var(--mut)' }}>
                Bills are imported into <b>{periodLabel(period.month, period.year)}</b> — the filename (without .pdf) becomes the subscriber name, and the
                Account Summary is searched on every page. Files stay on this computer.
              </div>
            </div>
            <button className="btn" onClick={() => void pick()}>
              <FilePlus2 size={15} /> Select PDFs…
            </button>
          </div>

          {drafts.length > 0 && (
            <div className="card p-4">
              <div className="flex items-center justify-between mb-2.5">
                <div className="panel-title">Selected files ({drafts.length}) — review before processing</div>
                <div className="flex gap-2">
                  <button className="btn btn-sm" onClick={() => setDrafts([])}><X size={13} /> Clear</button>
                  <button className="btn btn-sm btn-primary" onClick={() => void doImport()} disabled={busy}>
                    {busy ? <Spinner label="Importing…" /> : <><Play size={13} /> Import & process {drafts.length} file{drafts.length === 1 ? '' : 's'}</>}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 max-h-56 overflow-auto">
                {drafts.map((d, i) => {
                  const p = parseSubscriberFilename(d.fileName)
                  return (
                  <div key={d.path} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5" style={{ background: 'var(--panel-2)' }}>
                    <FileText size={14} style={{ color: 'var(--acc-2)' }} />
                    <span className="font-semibold text-[13px]">{d.fileName}</span>
                    <span className="text-[12px]" style={{ color: 'var(--mut)' }}>
                      → username “{p.name}”{p.title ? <> · title <b>{p.title}</b></> : null}{p.sr !== null ? <> · Sr. <b>{p.sr}</b></> : null}
                    </span>
                    <button className="btn btn-icon btn-sm ml-auto border-0 bg-transparent" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))} title="Remove from list">
                      <X size={13} />
                    </button>
                  </div>
                  )
                })}
              </div>
            </div>
          )}

          {result && (
            <div className="card px-4 py-2.5 text-[12.5px] flex items-center gap-2" style={{ background: 'var(--info-bg)' }}>
              <Play size={13} style={{ color: 'var(--acc-2)' }} />
              {result.imported.length} file{result.imported.length === 1 ? '' : 's'} queued for processing
              {result.skipped.length > 0 && <> · {result.skipped.length} duplicate skipped</>}
              {result.errors.length > 0 && <> · {result.errors.length} rejected (see toasts)</>}
              <span className="ml-auto" style={{ color: 'var(--mut)' }}>Status updates live below</span>
            </div>
          )}

          <div className="card">
            <div className="flex items-center gap-2 px-4 py-3 border-b flex-wrap" style={{ borderColor: 'var(--line)' }}>
              <div className="panel-title mr-auto">Imported bills — {total} file{total === 1 ? '' : 's'}</div>
              <button className="btn btn-sm" onClick={() => void processNow(pendingIds)} disabled={pendingIds.length === 0 || anyProcessing}>
                <RefreshCw size={13} /> Process pending / failed ({pendingIds.length})
              </button>
              <button
                className="btn"
                title="Re-run filename → Employee & SIM Directory matching for every bill without a directory link (fills Number / Designation immediately)"
                disabled={busy}
                onClick={async () => {
                  try {
                    const r = await call(window.api.bills.rematch(period?.id))
                    notify(r.linked > 0 ? `Directory re-match: ${r.linked} bill${r.linked === 1 ? '' : 's'} linked, ${r.promoted} cleared for review.` : 'No unmatched subscriber matched by name — check the spelling in the directory or pick entries in the review sheet.')
                    await refresh()
                  } catch (err) {
                    notify(errMsg(err), 'err')
                  }
                }}
              >
                <Users size={13} /> Re-match directory
              </button>
              {selIds.length > 0 && (
                <>
                  <button className="btn btn-sm" onClick={() => setSel(new Set())} disabled={bulkBusy}>
                    <X size={13} /> Clear selection ({selIds.length})
                  </button>
                  <button className="btn btn-sm btn-danger" onClick={() => setConfirmBulk(true)} disabled={bulkBusy}>
                    {bulkBusy ? <Spinner label="Deleting…" /> : <><Trash2 size={13} /> Delete selected ({selIds.length})</>}
                  </button>
                </>
              )}
              <button className="btn btn-sm" onClick={() => setManual(true)}>
                <FilePlus2 size={13} /> Manual entry
              </button>
              {anyProcessing && (
                <div className="w-52">
                  <div className="progress-line">
                    <div style={{ width: `${total === 0 ? 0 : Math.round((done / total) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>

            {total === 0 ? (
              <div className="p-8 text-center text-[13px]" style={{ color: 'var(--mut)' }}>
                No PDFs imported for this period yet. Drop files above or use “Select PDFs…”.
              </div>
            ) : (
              <div className="overflow-auto max-h-[52vh]">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="chk">
                        <input ref={chkAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} title="Select all" aria-label="Select all" />
                      </th>
                      <th>Filename</th>
                      <th>Subscriber Name</th>
                      <th>Mobile Number</th>
                      <th className="num">Basic Amount</th>
                      <th className="num">GST</th>
                      <th className="num">Total Payable</th>
                      <th>Status</th>
                      <th className="text-right">Review / Edit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map((b) => {
                      const live = progress[b.id]
                      const status = live?.status ?? statuses[b.id] ?? b.extractionStatus
                      const rec = records[b.id]
                      return (
                        <tr key={b.id} style={sel.has(b.id) ? { background: 'var(--panel-2)' } : undefined}>
                          <td className="chk">
                            <input type="checkbox" checked={sel.has(b.id)} onChange={() => toggle(b.id)} aria-label={'Select ' + b.originalFilename} />
                          </td>
                          <td>
                            <div className="flex items-center gap-1.5">
                              <FileText size={14} style={{ color: 'var(--mut)' }} />
                              <span className="font-semibold" title={b.originalPath ?? ''}>{b.originalFilename}</span>
                              {b.ocrUsed && <span className="badge badge-info">OCR</span>}
                              {b.isManual && <span className="badge badge-mut">manual</span>}
                            </div>
                            {b.errorMessage && status !== 'processing' && (
                              <div className="text-[11.5px] mt-0.5 max-w-[380px]" style={{ color: 'var(--bad)' }}>{b.errorMessage}</div>
                            )}
                            {!b.errorMessage && (records[b.id]?.warnings?.length ?? 0) > 0 && (
                              <div className="text-[11.5px] mt-0.5 max-w-[380px]" style={{ color: 'var(--warn)' }}>{records[b.id].warnings[0]}</div>
                            )}
                          </td>
                          <td>{rec?.username ?? b.subscriberName ?? '—'}</td>
                          <td className="mono">{rec?.mobileNumber ?? b.mobileNumber ?? <span style={{ color: 'var(--bad)' }}>not found</span>}</td>
                          <td className="num">{fmtChhRef(rec?.basicAmount)}</td>
                          <td className="num">{fmtChhRef(rec?.gst)}</td>
                          <td className="num">{fmtChhRef(rec?.totalAmount)}</td>
                          <td>
                            {status === 'processing' ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Spinner label={live?.message ?? 'Extracting…'} />
                                <span className="text-[11px]" style={{ color: 'var(--mut)' }}>
                                  {live ? `${live.processed}/${live.total} batch` : ''}
                                </span>
                              </span>
                            ) : (
                              <StatusBadge status={status} />
                            )}
                          </td>
                          <td>
                            <div className="flex gap-1 justify-end">
                              {rec && (
                                <button className="btn btn-sm" title={status === 'extracted' ? 'Open review / edit sheet' : 'Correct or confirm extracted values'} onClick={() => setEditing(rec)}>
                                  <Pencil size={13} /> {status === 'needs_review' || status === 'failed' ? 'Review' : 'Edit'}
                                </button>
                              )}
                              {!b.isManual && (
                                <button className="btn btn-sm" title="Re-extract this PDF" onClick={() => void retry(b.id)} disabled={anyProcessing}>
                                  <RefreshCw size={13} />
                                </button>
                              )}
                              <button className="btn btn-sm" title={status === 'pending' ? 'Remove before processing' : 'Remove bill from period'} onClick={() => setConfirmDel(b)}>
                                <Trash2 size={13} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {editing && (
        <RecordEditor
          record={records[editing.billId] ?? editing}
          onClose={() => {
            setEditing(null)
            void refresh()
          }}
        />
      )}
      {confirmDel && (
        <Confirm
          danger
          title="Remove imported bill"
          confirmLabel="Remove"
          body={
            <>
              Remove <b>{confirmDel.originalFilename}</b> and its summary row from this billing period? The copy stored inside the application folder will be
              deleted — <b>your original PDF file on disk is never modified or deleted.</b>
            </>
          }
          onConfirm={() => void remove(confirmDel.id)}
          onClose={() => setConfirmDel(null)}
        />
      )}
      {confirmBulk && (
        <Confirm
          danger
          title={`Remove ${selIds.length} selected bill${selIds.length === 1 ? '' : 's'}`}
          confirmLabel={`Remove ${selIds.length} bill${selIds.length === 1 ? '' : 's'}`}
          body={
            <>
              <div className="mb-2">These entries and their summary rows will be removed from this billing period:</div>
              <ul className="text-[12.5px]" style={{ color: 'var(--mut)', paddingLeft: 18, listStyle: 'disc' }}>
                {selectedBills.slice(0, 6).map((b) => (
                  <li key={b.id}>{b.originalFilename}</li>
                ))}
                {selectedBills.length > 6 && <li>…and {selectedBills.length - 6} more</li>}
              </ul>
              <div className="mt-2">The stored copies inside the app folder are deleted — <b>your original PDFs on disk are never modified or deleted.</b> Bills currently processing are skipped.</div>
            </>
          }
          onConfirm={() => void removeMany()}
          onClose={() => setConfirmBulk(false)}
        />
      )}
      {manual && period && <ManualEntryModal onClose={() => setManual(false)} periodId={period.id} onSaved={() => void refresh()} />}
    </div>
  )
}

function ManualEntryModal({
  periodId,
  onClose,
  onSaved
}: {
  periodId: number
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const { notify } = useApp()
  const [f, setF] = useState({
    subscriberName: '',
    originalFilename: '',
    mobileNumber: '',
    outstanding: null as number | null,
    penalty: null as number | null,
    basicAmount: null as number | null,
    gst: null as number | null,
    creditsDebits: null as number | null,
    totalAmount: null as number | null
  })
  const [saving, setSaving] = useState(false)

  const save = async (): Promise<void> => {
    if (!f.subscriberName.trim()) {
      notify('Subscriber name is required.', 'err')
      return
    }
    if (f.basicAmount === null && f.totalAmount === null) {
      notify('Enter at least the Bill Amount or the Total Payable.', 'err')
      return
    }
    setSaving(true)
    try {
      await call(
        window.api.bills.manual({
          periodId,
          subscriberName: f.subscriberName.trim(),
          originalFilename: f.originalFilename.trim() || (f.subscriberName.trim() + ' (manual entry)'),
          mobileNumber: f.mobileNumber.trim() || null,
          basicAmount: f.basicAmount,
          gst: f.gst,
          totalAmount: f.totalAmount,
          outstanding: f.outstanding,
          penalty: f.penalty,
          creditsDebits: f.creditsDebits
        })
      )
      notify('Manual bill entry added to the summary.', 'ok')
      onSaved()
      onClose()
    } catch (err) {
      notify(errMsg(err), 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="Manual bill entry (missing or unreadable PDF)"
      onClose={onClose}
      width={720}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Add to summary'}</button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="Subscriber name *" hint="Shown as Username in the report">
          <input className="input" autoFocus value={f.subscriberName} onChange={(e) => setF({ ...f, subscriberName: e.target.value })} placeholder="e.g. Mr. Akash Prajapati" />
        </Field>
        <Field label="Reference filename (optional)">
          <input className="input" value={f.originalFilename} onChange={(e) => setF({ ...f, originalFilename: e.target.value })} placeholder="e.g. Akash_bill_aug26.pdf" />
        </Field>
        <Field label="Mobile number">
          <input className="input mono" value={f.mobileNumber} onChange={(e) => setF({ ...f, mobileNumber: e.target.value })} placeholder="77100802" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Outstanding"><AmountInput value={f.outstanding} onChange={(v) => setF({ ...f, outstanding: v })} /></Field>
          <Field label="Penalty"><AmountInput value={f.penalty} onChange={(v) => setF({ ...f, penalty: v })} /></Field>
        </div>
        <Field label="Bill Amount (Basic) *"><AmountInput value={f.basicAmount} onChange={(v) => setF({ ...f, basicAmount: v })} /></Field>
        <Field label="GST"><AmountInput value={f.gst} onChange={(v) => setF({ ...f, gst: v })} /></Field>
        <Field label="Credits / Debits"><AmountInput value={f.creditsDebits} onChange={(v) => setF({ ...f, creditsDebits: v })} /></Field>
        <Field label="Total Payable *"><AmountInput value={f.totalAmount} onChange={(v) => setF({ ...f, totalAmount: v })} /></Field>
      </div>
      <div className="text-[12px] mt-3" style={{ color: 'var(--mut)' }}>
        All amounts are in Nu. with two decimals. The entry is saved as reviewed and joins the report like an extracted bill.
      </div>
    </Modal>
  )
}
