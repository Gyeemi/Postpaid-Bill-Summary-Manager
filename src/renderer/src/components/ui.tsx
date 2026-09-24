import React, { useEffect, useRef, useState } from 'react'
import { X, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react'
import type { ExtractionStatus } from '../../../shared/types'
import { useApp } from '../state/store'
import { validateAmountInput } from '../../../shared/money'

export function StatusBadge({ status, small }: { status: ExtractionStatus | 'included' | 'excluded'; small?: boolean }): React.JSX.Element {
  const map: Record<string, { cls: string; label: string }> = {
    pending: { cls: 'badge-mut', label: 'Pending' },
    processing: { cls: 'badge-info', label: 'Processing' },
    extracted: { cls: 'badge-ok', label: 'Extracted' },
    needs_review: { cls: 'badge-warn', label: 'Needs Review' },
    failed: { cls: 'badge-bad', label: 'Extraction Failed' },
    included: { cls: 'badge-ok', label: 'Included' },
    excluded: { cls: 'badge-mut', label: 'Excluded' }
  }
  const m = map[status] ?? map.pending
  return (
    <span className={`badge ${m.cls}`} style={small ? { padding: '2px 8px', fontSize: 11 } : undefined}>
      {status === 'processing' && <Loader2 size={12} className="animate-spin" />}
      {m.label}
    </span>
  )
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-2 text-[13px]" style={{ color: 'var(--mut)' }}>
      <Loader2 size={15} className="animate-spin" /> {label ?? 'Loading…'}
    </span>
  )
}

export function Toasts(): React.JSX.Element {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[380px]">
      {toasts.map((t) => (
        <div key={t.id} className={`toast card px-3.5 py-3 flex items-start gap-2.5 ${t.kind === 'err' ? 'toast-err' : t.kind === 'ok' ? 'toast-ok' : ''}`}>
          <span className="mt-0.5 shrink-0" style={{ color: t.kind === 'err' ? 'var(--bad)' : t.kind === 'ok' ? 'var(--ok)' : 'var(--acc-2)' }}>
            {t.kind === 'err' ? <AlertTriangle size={16} /> : t.kind === 'ok' ? <CheckCircle2 size={16} /> : <Info size={16} />}
          </span>
          <div className="flex-1 text-[13px] leading-snug whitespace-pre-wrap">{t.text}</div>
          <button className="btn-icon btn border-0 bg-transparent hover:bg-transparent p-0.5" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}

export function Modal({
  title,
  onClose,
  children,
  width = 620,
  footer
}: {
  title: React.ReactNode
  onClose: () => void
  children: React.ReactNode
  width?: number
  footer?: React.ReactNode
}): React.JSX.Element {
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card w-full" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--line)' }}>
          <div className="panel-title">{title}</div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="px-5 py-4 max-h-[70vh] overflow-auto">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t flex justify-end gap-2" style={{ borderColor: 'var(--line)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

export function Confirm({
  title,
  body,
  danger,
  confirmLabel,
  onConfirm,
  onClose
}: {
  title: string
  body: React.ReactNode
  danger?: boolean
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel ?? 'Confirm'}
          </button>
        </>
      }
    >
      <div className="text-[13.5px] leading-relaxed" style={{ color: 'var(--mut)' }}>{body}</div>
    </Modal>
  )
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }): React.JSX.Element {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[11.5px] mt-1" style={{ color: 'var(--mut)' }}>{hint}</span>}
    </label>
  )
}

/** amount input bound to chhatrum; validates on change, shows inline error */
export function AmountInput({
  value,
  onChange,
  placeholder,
  allowNegative = true
}: {
  value: number | null
  onChange: (v: number | null) => void
  placeholder?: string
  allowNegative?: boolean
}): React.JSX.Element {
  const [text, setText] = useState(value === null ? '' : fmt(value))
  const focused = useRef(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!focused.current) {
      setText(value === null ? '' : fmt(value))
      setErr(null)
    }
  }, [value])
  return (
    <div>
      <input
        className={`input mono text-right ${err ? 'err' : ''}`}
        value={text}
        placeholder={placeholder ?? '0.00'}
        inputMode="decimal"
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false
          const r = validateAmountInput(text)
          if (!r.ok) {
            setErr(r.error ?? 'Invalid amount')
            return
          }
          if (!allowNegative && r.chh !== null && r.chh < 0) {
            setErr('Negative values are not allowed here')
            return
          }
          setErr(null)
          setText(r.chh === null ? '' : fmt(r.chh))
          onChange(r.chh)
        }}
        onChange={(e) => {
          setText(e.target.value)
          if (!e.target.value.trim()) {
            setErr(null)
            onChange(null)
          }
        }}
      />
      {err && <div className="text-[11.5px] mt-1" style={{ color: 'var(--bad)' }}>{err}</div>}
    </div>
  )
}

function fmt(chh: number): string {
  const neg = chh < 0
  const abs = Math.abs(chh)
  const i = Math.floor(abs / 100)
  const d = (abs % 100).toString().padStart(2, '0')
  return `${neg ? '-' : ''}${i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${d}`
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
      {icon && <div style={{ color: 'var(--mut)' }}>{icon}</div>}
      <div className="font-bold text-[15px]">{title}</div>
      {body && <div className="text-[13px] max-w-[420px]" style={{ color: 'var(--mut)' }}>{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** Compact month + year selector used for the two independent report months. */
export function MonthYearSelect({
  month,
  year,
  onChange,
  onClear,
  allowClear = false,
  label
}: {
  month: number | null
  year: number | null
  onChange: (month: number, year: number) => void
  onClear?: () => void
  allowClear?: boolean
  label?: string
}): React.JSX.Element {
  const nowYear = new Date().getFullYear()
  const years = Array.from({ length: 13 }, (_, i) => nowYear - 6 + i)
  const selYear = year && years.includes(year) ? year : year ?? nowYear
  const set = (m: number | null, y: number | null): void => {
    if (m && y) onChange(m, y)
    else if (allowClear && onClear && (m === null || y === null)) onClear()
  }
  return (
    <div className="flex gap-1.5 items-center">
      <select
        className="select"
        aria-label={label ? `${label} month` : 'month'}
        value={month ?? ''}
        onChange={(e) => set(e.target.value ? Number(e.target.value) : null, selYear)}
      >
        <option value="" disabled={month !== null}>
          {month === null ? 'Select month…' : ''}
        </option>
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <select
        className="select"
        style={{ width: 92 }}
        aria-label={label ? `${label} year` : 'year'}
        value={selYear}
        onChange={(e) => set(month, Number(e.target.value))}
      >
        {years.map((y) => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
      {allowClear && month !== null && onClear && (
        <button className="btn btn-sm" title="Clear" onClick={onClear}>✕</button>
      )}
    </div>
  )
}
