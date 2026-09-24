/** Display formatting helpers for the renderer (all money is chhatrum ints). */
import { formatChh, formatMoney, parseAmountToChh } from '../../../shared/money'

export const fmtMoney = (chh: number | null | undefined, dash = '—'): string =>
  chh === null || chh === undefined ? dash : formatMoney(chh, 'Nu.', dash)

export const fmtAmount = (chh: number | null | undefined, dash = '—'): string =>
  chh === null || chh === undefined ? dash : formatChh(chh)

export const parseAmount = (s: string): number | null => parseAmountToChh(s)

export const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

export const periodLabel = (month: number, year: number): string => `${MONTHS[month - 1] ?? '?'} ${year}`

export const todayIso = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const fmtChhRef = (chh: number | null | undefined): string => (chh === null || chh === undefined ? '—' : formatChh(chh))
