/**
 * Decimal-safe money helpers.
 *
 * Every amount in the application is stored and transported as an integer
 * number of **chhatrum** (1 Nu. = 100 chh). Parsing from bill text goes
 * straight from string -> integer minor units; no intermediate float is ever
 * used for stored values.
 */

const HALF_UP_EPSILON = 1e-9

/** Round a float to N decimals, half away from zero (financial rounding). */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return NaN
  const f = 10 ** decimals
  const scaled = value * f
  const r = scaled >= 0 ? Math.floor(scaled + 0.5 + HALF_UP_EPSILON) : Math.ceil(scaled - 0.5 - HALF_UP_EPSILON)
  return r / f
}

/**
 * Parse a display amount ("1,077.00", "-0.78", "(53.85)", "Nu. 1,131.00")
 * into integer chhatrum. Returns null when the text is not a valid amount.
 */
export function parseAmountToChh(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null
    const v = round(input, 2) * 100
    return Number.isSafeInteger(Math.round(v)) ? Math.round(v) : null
  }
  let s = String(input).trim()
  if (!s) return null
  // strip currency names/symbols and spaces
  s = s.replace(/nu\.?/gi, '').replace(/[₭$ ]/g, '').replace(/\u00a0/g, '').trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(/^-/, '')
  if (/^-/.test(String(input))) negative = true
  // strict shape: optional groups with commas, exactly one decimal point part
  const m = /^(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(s)
  if (!m) {
    // lenient fallback: only digits and a dot — never accept malformed comma
    // groups like "1,2,3"
    if (s.includes(',')) return null
    const cleaned = s.replace(/,/g, '')
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
    s = cleaned
    const [intPart, decPart] = s.split('.')
    const chh = parseInt(intPart, 10) * 100 + (decPart ? parseInt(decPart.padEnd(2, '0'), 10) : 0)
    if (!Number.isSafeInteger(chh)) return null
    return negative ? -chh : chh
  }
  const intPart = m[1].replace(/,/g, '')
  const decPart = (m[2] ?? '').padEnd(2, '0')
  const chh = parseInt(intPart, 10) * 100 + parseInt(decPart, 10)
  if (!Number.isSafeInteger(chh)) return null
  return negative ? -chh : chh
}

/** Format chhatrum -> "1,077.00" (US grouping like the office sample reports). */
export function formatChh(chh: number | null | undefined, opts?: { dash?: string }): string {
  if (chh === null || chh === undefined || !Number.isFinite(chh)) {
    return opts?.dash ?? '—'
  }
  const neg = chh < 0
  const abs = Math.abs(chh)
  const intPart = Math.floor(abs / 100).toString()
  const decPart = (abs % 100).toString().padStart(2, '0')
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${neg ? '-' : ''}${grouped}.${decPart}`
}

/** "Nu. 1,077.00" or "Nu. -1,077.00" */
export function formatMoney(chh: number | null | undefined, currency = 'Nu.', dash?: string): string {
  const s = formatChh(chh, { dash })
  if (dash && s === dash) return s
  return `${currency} ${s}`
}

/** Compute GST in chhatrum from a basic amount, rounded to paise equivalent. */
export function computeGstChh(basicChh: number, gstRatePercent: number): number {
  return Math.round(round((basicChh * gstRatePercent) / 100, 0))
}

export function sumChh(values: (number | null | undefined)[]): number {
  let acc = 0
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v)) acc += v
  }
  return acc
}

/** Validate a user-typed amount string for input fields; returns chh or null. */
export function validateAmountInput(s: string): { ok: boolean; chh: number | null; error?: string } {
  if (s.trim() === '') return { ok: true, chh: null }
  const chh = parseAmountToChh(s)
  if (chh === null) return { ok: false, chh: null, error: 'Enter a valid amount, e.g. 1,077.00' }
  if (Math.abs(chh) > 1_000_000_00_00) return { ok: false, chh: null, error: 'Amount out of range' }
  return { ok: true, chh }
}
