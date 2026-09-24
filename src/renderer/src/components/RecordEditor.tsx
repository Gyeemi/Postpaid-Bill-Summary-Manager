import React, { useMemo, useState } from 'react'
import { Calculator, FileText, RotateCcw, ScanLine } from 'lucide-react'
import type { BillRecord } from '../../../shared/types'
import { useApp } from '../state/store'
import { call } from '../lib/api'
import { Field, Modal, AmountInput } from './ui'
import { fmtChhRef } from '../lib/format'
import { computeGstChh } from '../../../shared/money'

const TITLES = ['', 'Mr.', 'Mrs.', 'Ms.', 'Dr.']

/**
 * Review / edit sheet for one bill: corrects the working copy while the
 * original extracted values stay visible and untouched for reference.
 */
export function RecordEditor({
  record,
  onClose,
  manualAllowed = false
}: {
  record: BillRecord
  onClose: () => void
  manualAllowed?: boolean
}): React.JSX.Element {
  const { employees, bump, notify, settings } = useApp()
  const gstRate = settings?.gstRatePercent ?? 5
  const [form, setForm] = useState({
    title: record.title ?? '',
    username: record.username ?? '',
    designation: record.designation ?? '',
    mobileNumber: record.mobileNumber ?? '',
    employeeId: record.employeeId,
    basicAmount: record.basicAmount,
    gst: record.gst,
    outstanding: record.outstanding,
    penalty: record.penalty,
    creditsDebits: record.creditsDebits,
    totalAmount: record.totalAmount,
    deduction: record.deduction,
    includeInReport: record.includeInReport,
    reviewed: record.reviewed
  })
  const [empSearch, setEmpSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const bill = record.bill

  const empMatches = useMemo(() => {
    const q = empSearch.trim().toLowerCase()
    const list = employees.filter((e) => e.isActive)
    if (!q) return list.slice(0, 40)
    return list.filter((e) => `${e.title ?? ''} ${e.name} ${e.designation ?? ''} ${e.mobile ?? ''}`.toLowerCase().includes(q)).slice(0, 40)
  }, [employees, empSearch])

  const mismatch =
    form.basicAmount !== null && form.totalAmount !== null
      ? (form.basicAmount ?? 0) + (form.gst ?? 0) + (form.outstanding ?? 0) + (form.penalty ?? 0) + (form.creditsDebits ?? 0) - form.totalAmount
      : null

  const save = async (markReviewed: boolean): Promise<void> => {
    setSaving(true)
    try {
      await call(
        window.api.records.update(record.id, {
          ...form,
          title: form.title || null,
          username: form.username.trim() || null,
          designation: form.designation.trim() || null,
          mobileNumber: form.mobileNumber.trim() || null,
          markReviewed: markReviewed || undefined
        })
      )
      bump()
      notify('Record saved.', 'ok')
      onClose()
    } catch (err) {
      notify((err as Error).message, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          Review bill — {bill?.originalFilename ?? 'Record'}
          {bill?.ocrUsed && (
            <span className="badge badge-info" title="Text was obtained with local OCR">
              <ScanLine size={12} /> OCR
            </span>
          )}
        </span>
      }
      onClose={onClose}
      width={760}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          {record.extractionStatus === 'needs_review' && (
            <button className="btn" onClick={() => void save(true)} disabled={saving}>
              Save & mark reviewed
            </button>
          )}
          <button className="btn btn-primary" onClick={() => void save(false)} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      {bill && (
        <div className="rounded-lg px-3.5 py-2.5 mb-4 text-[12px]" style={{ background: 'var(--panel-2)' }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-semibold"><FileText size={13} /> {bill.originalFilename}</span>
            {bill.summaryPage && <span style={{ color: 'var(--mut)' }}>Account Summary found on page {bill.summaryPage}</span>}
            <span style={{ color: 'var(--mut)' }}>Imported {bill.createdAt.slice(0, 16)}</span>
          </div>
          {record.warnings.length > 0 && (
            <ul className="mt-1.5 pl-4 list-disc" style={{ color: 'var(--warn)' }}>
              {record.warnings.map((w: string, i: number) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {bill.errorMessage && <div className="mt-1.5" style={{ color: 'var(--bad)' }}>{bill.errorMessage}</div>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3.5">
        <Field label="Title">
          <select className="select" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}>
            {TITLES.map((t) => (
              <option key={t} value={t}>{t || '(blank)'}</option>
            ))}
          </select>
        </Field>
        <Field label="Username / SIM description">
          <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        </Field>
        <Field label="Designation">
          <input className="input" value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} />
        </Field>
        <Field label="Mobile number">
          <input className="input mono" value={form.mobileNumber} onChange={(e) => setForm({ ...form, mobileNumber: e.target.value })} placeholder="77100802" />
        </Field>
      </div>

      <div className="mt-4">
        <Field label="Link directory entry (auto-matched from the number when possible)">
          <div className="flex gap-2 mb-1.5">
            <input className="input" placeholder="Search name, designation or number…" value={empSearch} onChange={(e) => setEmpSearch(e.target.value)} />
            {form.employeeId !== null && (
              <button className="btn btn-sm shrink-0" onClick={() => setForm({ ...form, employeeId: null })}>Unlink</button>
            )}
          </div>
          <div className="border rounded-lg overflow-auto max-h-36" style={{ borderColor: 'var(--line)' }}>
            {form.employeeId !== null && (
              <div className="px-3 py-1.5 text-[12.5px]" style={{ background: 'var(--info-bg)' }}>
                Linked to employee #{form.employeeId} ·{' '}
                {employees.find((e) => e.id === form.employeeId)?.name ?? 'removed entry'}
              </div>
            )}
            {empMatches.map((e) => (
              <button
                key={e.id}
                className="w-full text-left px-3 py-1.5 text-[12.5px] flex items-center gap-3 hover:bg-[var(--panel-2)]"
                onClick={() =>
                  setForm({
                    ...form,
                    employeeId: e.id,
                    title: e.title ?? form.title,
                    username: e.name,
                    designation: e.designation ?? form.designation,
                    mobileNumber: e.mobile ?? form.mobileNumber
                  })
                }
              >
                <b>{e.title ? `${e.title} ` : ''}{e.name}</b>
                <span style={{ color: 'var(--mut)' }}>{e.designation}</span>
                <span className="mono ml-auto" style={{ color: 'var(--mut)' }}>{e.mobile}</span>
              </button>
            ))}
            {empMatches.length === 0 && <div className="px-3 py-2 text-[12.5px]" style={{ color: 'var(--mut)' }}>No directory matches — keep the values above.</div>}
          </div>
        </Field>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3">
        <div>
          <div className="label" style={{ color: 'var(--acc-2)' }}>Working values (editable — mirrors the bill's Account Summary)</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            <Field label="Outstanding (Nu.)">
              <AmountInput value={form.outstanding} onChange={(v) => setForm({ ...form, outstanding: v })} />
            </Field>
            <Field label="Penalty (Nu.)">
              <AmountInput value={form.penalty} onChange={(v) => setForm({ ...form, penalty: v })} />
            </Field>
            <Field label="Bill Amount (Nu.)">
              <AmountInput value={form.basicAmount} onChange={(v) => setForm({ ...form, basicAmount: v })} />
            </Field>
            <Field label={`GST @ ${gstRate}% (Nu.)`}>
              <div className="flex gap-1.5">
                <AmountInput value={form.gst} onChange={(v) => setForm({ ...form, gst: v })} />
                <button
                  className="btn btn-sm shrink-0 self-start"
                  title={`Calculate GST at ${gstRate}% from the Bill Amount`}
                  onClick={() => {
                    if (form.basicAmount === null) {
                      notify('Enter the Bill Amount first.', 'err')
                      return
                    }
                    setForm({ ...form, gst: computeGstChh(form.basicAmount, gstRate) })
                  }}
                >
                  <Calculator size={14} />
                </button>
              </div>
            </Field>
            <Field label="Credits / Debits (Nu.)" hint="use a minus sign for net credits">
              <AmountInput value={form.creditsDebits} onChange={(v) => setForm({ ...form, creditsDebits: v })} />
            </Field>
            <Field label="Total Payable (Nu.)" hint="the printed bill amount — kept as-is">
              <AmountInput value={form.totalAmount} onChange={(v) => setForm({ ...form, totalAmount: v })} />
            </Field>
            <Field label="Deduction (Nu.)">
              <AmountInput value={form.deduction} onChange={(v) => setForm({ ...form, deduction: v ?? 0 })} />
            </Field>
          </div>
        </div>
        <div>
          <div className="label">As extracted from the PDF (reference — never overwritten)</div>
          <table className="tbl text-[12.5px]">
            <tbody>
              <tr>
                <td style={{ color: 'var(--mut)' }}>Directory number (authoritative)</td>
                <td className="mono">
                  {form.mobileNumber || <span style={{ color: 'var(--bad)' }}>no directory match yet</span>}
                  <span className="badge badge-mut" style={{ marginLeft: 6 }}>
                    {String((bill?.fieldEvidence as Record<string, unknown> | null)?.['mobileSource'] ?? 'none')}
                  </span>
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--mut)' }}>Service Number printed in PDF</td>
                <td className="mono">{String((bill?.fieldEvidence as Record<string, unknown> | null)?.['serviceNumberHint'] ?? '—')}</td>
              </tr>
              <tr><td style={{ color: 'var(--mut)' }}>Outstanding</td><td className="num">{fmtChhRef(bill?.outstanding)}</td></tr>
              <tr><td style={{ color: 'var(--mut)' }}>Penalty</td><td className="num">{fmtChhRef(bill?.penalty)}</td></tr>
              <tr><td style={{ color: 'var(--mut)' }}>Bill Amount</td><td className="num">{fmtChhRef(bill?.billAmount)}</td></tr>
              <tr><td style={{ color: 'var(--mut)' }}>GST</td><td className="num">{fmtChhRef(bill?.gst)}</td></tr>
              <tr><td style={{ color: 'var(--mut)' }}>Credits / Debits</td><td className="num">{fmtChhRef(bill?.creditsDebits)}</td></tr>
              <tr><td style={{ color: 'var(--mut)' }}>Total Payable</td><td className="num">{fmtChhRef(bill?.totalPayable)}</td></tr>
            </tbody>
          </table>
          {bill &&
            (bill.billAmount !== record.basicAmount ||
              bill.gst !== record.gst ||
              bill.totalPayable !== record.totalAmount ||
              bill.outstanding !== record.outstanding ||
              bill.penalty !== record.penalty ||
              bill.creditsDebits !== record.creditsDebits) && (
            <button
              className="btn btn-sm mt-2"
              onClick={() =>
                setForm({
                  ...form,
                  basicAmount: bill.billAmount,
                  gst: bill.gst,
                  outstanding: bill.outstanding,
                  penalty: bill.penalty,
                  creditsDebits: bill.creditsDebits,
                  totalAmount: bill.totalPayable
                })
              }
            >
              <RotateCcw size={13} /> Restore extracted values
            </button>
          )}
        </div>
      </div>

      {mismatch !== null && mismatch !== 0 && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-[12.5px]"
          style={Math.abs(mismatch) <= 100 ? { background: 'var(--info-bg)', color: 'var(--acc)' } : { background: 'var(--warn-bg)', color: 'var(--warn)' }}
        >
          {mismatch > 0 ? 'Bill components sum to Nu. ' + fmtChhRef(mismatch) + ' more' : 'Bill components sum to Nu. ' + fmtChhRef(-mismatch) + ' less'}{' '}
          than the printed Total Payable{' '}
          {Math.abs(mismatch) <= 100
            ? '(≤ Nu. 1.00 — ordinary bill-side rounding; Total Payable is kept exactly as printed).'
            : '— recheck the lines above against the Account Summary block; the printed Total Payable is always kept as the report total.'}
        </div>
      )}

      <div className="mt-4 flex items-center gap-5 text-[13px]">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.includeInReport} onChange={(e) => setForm({ ...form, includeInReport: e.target.checked })} />
          Include in Bill Summary report
        </label>
        {record.extractionStatus === 'needs_review' && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.reviewed} onChange={(e) => setForm({ ...form, reviewed: e.target.checked })} />
            I have verified these values
          </label>
        )}
        {!manualAllowed && record.isManual && <span className="badge badge-info">Manual entry</span>}
      </div>
    </Modal>
  )
}
